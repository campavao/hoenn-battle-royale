// Hoenn Battle Royale headless driver harness (POK-214).
//
// Runs the ROM inside libmgba with no window, no audio, driven by a text script:
// press buttons, wait frames, dump PNG frames, read and write RAM, assert values.
// Exit code 0 when every `expect` held, 1 on the first failed expect (with the line),
// 2+ on setup errors. Grew out of the Pokemon Emerson emutest harness.
//
//   harness <rom> <driver.txt> <outdir> [--state file.ss1] [--symbols br-symbols.json]
//
// Driver grammar, one action per line, `#` comments:
//   state <path.ss1>            load a savestate (SAVESTATE_ALL)
//   wait <frames>               run frames with no input
//   hold <KEYS> <frames>        hold keys (A B SELECT START RIGHT LEFT UP DOWN R L, join with +)
//   tap <KEYS>                  hold 4 frames, release, 1 frame
//   shot <name>                 write <outdir>/<name>.png
//   expect u8|u16|u32 <addr> <value>     assert; <addr> is 0xHEX or sym or sym+0xOFF
//   expectge u8|u16|u32 <addr> <value>   assert got >= value
//   <addr> may also be *sym+off: dereference the u32 at sym, then add off
//   dump <addr> <len>           hex dump
//   copy <dst> <src> <len>      copy bytes within RAM
//   poke u8|u16|u32 <addr> <value>
//   pokebytes <addr> <hex hex ...>
//   say <text>                  echo
//   title                       print the game code at 0x080000AC
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/core/log.h>
#include <mgba/core/serialize.h>
#include <mgba-util/vfs.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>  // strcasecmp; glibc only declares it here, not in string.h
#include <ctype.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

static void _log(struct mLogger* log, int category, enum mLogLevel level, const char* format, va_list args) {
    (void)log; (void)category; (void)level; (void)format; (void)args;
}
static struct mLogger logger = { .log = _log };

static struct mCore* core;
static void* vbuf;
static unsigned W, H;
static const char* outdir;
static int lineNo;

// ---- symbols ------------------------------------------------------------------
// br-symbols.json is `{ "name": "0x02001234", ... }`; a tiny scanner is enough.
struct Sym { char name[64]; uint32_t addr; };
static struct Sym syms[512];
static int nsyms;

static void loadSymbols(const char* path) {
    FILE* f = fopen(path, "rb");
    if (!f) { printf("symbols open failed: %s\n", path); return; }
    char line[512];
    while (fgets(line, sizeof line, f) && nsyms < 512) {
        char* q = strchr(line, '"');
        if (!q) continue;
        char* e = strchr(q + 1, '"');
        if (!e) continue;
        size_t n = (size_t)(e - q - 1);
        if (n == 0 || n >= sizeof syms[0].name) continue;
        char* x = strstr(e + 1, "0x");
        if (!x) continue;
        memcpy(syms[nsyms].name, q + 1, n);
        syms[nsyms].name[n] = 0;
        syms[nsyms].addr = (uint32_t)strtoul(x, NULL, 16);
        nsyms++;
    }
    fclose(f);
    printf("symbols: %d from %s\n", nsyms, path);
}

static int parseAddr(const char* s, uint32_t* out) {
    // `*sym+off` reads the u32 pointer at sym first (gSaveBlock1Ptr etc. are pointers).
    if (s[0] == '*') {
        uint32_t p;
        const char* plus = strchr(s, '+');
        char base[64];
        size_t n = plus ? (size_t)(plus - s - 1) : strlen(s + 1);
        if (n >= sizeof base) return 0;
        memcpy(base, s + 1, n); base[n] = 0;
        if (!parseAddr(base, &p)) return 0;
        *out = core->busRead32(core, p) + (plus ? (uint32_t)strtoul(plus + 1, NULL, 0) : 0);
        return 1;
    }
    if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) { *out = (uint32_t)strtoul(s, NULL, 16); return 1; }
    char name[64];
    uint32_t off = 0;
    const char* plus = strchr(s, '+');
    size_t n = plus ? (size_t)(plus - s) : strlen(s);
    if (n >= sizeof name) return 0;
    memcpy(name, s, n); name[n] = 0;
    if (plus) off = (uint32_t)strtoul(plus + 1, NULL, 0);
    for (int i = 0; i < nsyms; ++i) {
        if (strcmp(syms[i].name, name) == 0) { *out = syms[i].addr + off; return 1; }
    }
    printf("line %d: unknown symbol %s\n", lineNo, name);
    return 0;
}

// ---- keys -----------------------------------------------------------------------
static const char* keyNames[] = { "A", "B", "SELECT", "START", "RIGHT", "LEFT", "UP", "DOWN", "R", "L" };

static int parseKeys(const char* s, uint32_t* mask) {
    *mask = 0;
    char buf[64];
    strncpy(buf, s, sizeof buf - 1); buf[sizeof buf - 1] = 0;
    for (char* tok = strtok(buf, "+"); tok; tok = strtok(NULL, "+")) {
        int hit = 0;
        for (int i = 0; i < 10; ++i) if (strcasecmp(tok, keyNames[i]) == 0) { *mask |= 1u << i; hit = 1; }
        if (!hit) { printf("line %d: unknown key %s\n", lineNo, tok); return 0; }
    }
    return 1;
}

// ---- actions --------------------------------------------------------------------
static void runN(int n) { for (int i = 0; i < n; ++i) core->runFrame(core); }

static void shot(const char* name) {
    char path[1024];
    // mGBA leaves the alpha byte 0, which viewers render as blank; force opaque.
    uint8_t* px = (uint8_t*)vbuf;
    size_t i;
    for (i = 3; i < (size_t)W * H * 4; i += 4) px[i] = 0xFF;
    snprintf(path, sizeof path, "%s/%s.png", outdir, name);
    stbi_write_png(path, (int)W, (int)H, 4, vbuf, (int)W * 4);
    printf("shot %s\n", path);
}

static int loadState(const char* path) {
    struct VFile* vf = VFileOpen(path, O_RDONLY);
    if (!vf) { printf("state open failed: %s\n", path); return 0; }
    int ok = mCoreLoadStateNamed(core, vf, SAVESTATE_ALL);
    vf->close(vf);
    printf("state %s -> %s\n", path, ok ? "ok" : "FAILED");
    return ok;
}

static uint32_t readW(int width, uint32_t addr) {
    switch (width) {
    case 8: return core->busRead8(core, addr);
    case 16: return core->busRead16(core, addr);
    default: return core->busRead32(core, addr);
    }
}
static void writeW(int width, uint32_t addr, uint32_t v) {
    switch (width) {
    case 8: core->busWrite8(core, addr, (uint8_t)v); break;
    case 16: core->busWrite16(core, addr, (uint16_t)v); break;
    default: core->busWrite32(core, addr, v); break;
    }
}
static int widthOf(const char* s) {
    if (strcmp(s, "u8") == 0) return 8;
    if (strcmp(s, "u16") == 0) return 16;
    if (strcmp(s, "u32") == 0) return 32;
    return 0;
}

static int runLine(char* line) {
    char* p = line;
    while (isspace((unsigned char)*p)) p++;
    if (*p == 0 || *p == '#') return 0;
    char* nl = strpbrk(p, "\r\n"); if (nl) *nl = 0;

    char a[64], b[64], c[64], d[64];
    int n = sscanf(p, "%63s %63s %63s %63s", a, b, c, d);
    if (n < 1) return 0;

    if (strcmp(a, "say") == 0) { printf("%s\n", p + 3 + (p[3] == ' ')); return 0; }
    if (strcmp(a, "wait") == 0 && n >= 2) { runN(atoi(b)); return 0; }
    if (strcmp(a, "shot") == 0 && n >= 2) { shot(b); return 0; }
    if (strcmp(a, "state") == 0 && n >= 2) { return loadState(b) ? 0 : 3; }
    if (strcmp(a, "title") == 0) {
        char code[5] = {0};
        for (int i = 0; i < 4; ++i) code[i] = (char)core->busRead8(core, 0x080000AC + i);
        printf("game code %s\n", code);
        return 0;
    }
    if ((strcmp(a, "hold") == 0 && n >= 3) || (strcmp(a, "tap") == 0 && n >= 2)) {
        uint32_t mask;
        if (!parseKeys(b, &mask)) return 4;
        int frames = strcmp(a, "tap") == 0 ? 4 : atoi(c);
        core->setKeys(core, mask);
        runN(frames);
        core->setKeys(core, 0);
        runN(1);
        return 0;
    }
    if ((strcmp(a, "expect") == 0 || strcmp(a, "expectge") == 0) && n >= 4) {
        int ge = a[6] == 'g';
        int w = widthOf(b); uint32_t addr, want;
        if (!w || !parseAddr(c, &addr)) return 4;
        want = (uint32_t)strtoul(d, NULL, 0);
        uint32_t got = readW(w, addr);
        if (ge ? got < want : got != want) { printf("line %d: EXPECT FAILED %s at 0x%08X: got 0x%X want %s0x%X\n", lineNo, b, addr, got, ge ? ">= " : "", want); return 1; }
        printf("expect ok %s 0x%08X = 0x%X\n", b, addr, got);
        return 0;
    }
    if (strcmp(a, "poke") == 0 && n >= 4) {
        int w = widthOf(b); uint32_t addr;
        if (!w || !parseAddr(c, &addr)) return 4;
        writeW(w, addr, (uint32_t)strtoul(d, NULL, 0));
        return 0;
    }
    if (strcmp(a, "pokebytes") == 0 && n >= 3) {
        uint32_t addr; if (!parseAddr(b, &addr)) return 4;
        char* rest = strstr(p, b) + strlen(b);
        int i = 0;
        for (char* tok = strtok(rest, " \t"); tok; tok = strtok(NULL, " \t"), ++i)
            core->busWrite8(core, addr + i, (uint8_t)strtoul(tok, NULL, 16));
        printf("poked %d bytes at 0x%08X\n", i, addr);
        return 0;
    }
    if (strcmp(a, "copy") == 0 && n >= 4) {
        uint32_t dst, src; int len = atoi(d), i;
        if (!parseAddr(b, &dst) || !parseAddr(c, &src)) return 4;
        for (i = 0; i < len; ++i) core->busWrite8(core, dst + i, (uint8_t)core->busRead8(core, src + i));
        printf("copied %d bytes 0x%08X -> 0x%08X\n", len, src, dst);
        return 0;
    }
    if (strcmp(a, "dump") == 0 && n >= 3) {
        uint32_t addr; if (!parseAddr(b, &addr)) return 4;
        int len = atoi(c);
        printf("dump 0x%08X:", addr);
        for (int i = 0; i < len; ++i) printf("%s%02x", (i % 16 == 0) ? "\n  " : " ", core->busRead8(core, addr + i));
        printf("\n");
        return 0;
    }
    printf("line %d: unknown action: %s\n", lineNo, p);
    return 4;
}

int main(int argc, char** argv) {
    if (argc < 4) { printf("usage: harness <rom> <driver.txt> <outdir> [--state f.ss1] [--symbols f.json]\n"); return 2; }
    const char* rom = argv[1];
    const char* driver = argv[2];
    outdir = argv[3];
    const char* state = NULL; const char* symbols = NULL;
    for (int i = 4; i + 1 < argc; i += 2) {
        if (strcmp(argv[i], "--state") == 0) state = argv[i + 1];
        else if (strcmp(argv[i], "--symbols") == 0) symbols = argv[i + 1];
    }

    mLogSetDefaultLogger(&logger);
    core = mCoreFind(rom);
    if (!core) { printf("mCoreFind failed: %s\n", rom); return 2; }
    core->init(core);
    core->desiredVideoDimensions(core, &W, &H);
    vbuf = malloc((size_t)W * H * BYTES_PER_PIXEL);
    core->setVideoBuffer(core, vbuf, W);
    if (!mCoreLoadFile(core, rom)) { printf("load failed: %s\n", rom); return 2; }
    mCoreConfigInit(&core->config, NULL);
    mCoreLoadConfig(core);
    core->reset(core);
    printf("rom %s (%ux%u)\n", rom, W, H);
    if (symbols) loadSymbols(symbols);
    if (state && !loadState(state)) return 3;

    FILE* f = fopen(driver, "rb");
    if (!f) { printf("driver open failed: %s\n", driver); return 2; }
    char line[1024];
    int rc = 0;
    while (fgets(line, sizeof line, f)) {
        lineNo++;
        rc = runLine(line);
        fflush(stdout);
        if (rc) break;
    }
    fclose(f);
    printf(rc ? "FAIL (rc %d at line %d)\n" : "PASS\n", rc, lineNo);
    core->deinit(core);
    return rc;
}
