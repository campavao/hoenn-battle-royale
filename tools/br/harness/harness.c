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
//   mailsend <mailbox> <type> <src> <len>   frame <len> bytes at <src> as a BR wire
//                               message of <type> and push it into the page -> ROM ring
//                               (splitting across continuation slots), playing the page
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
// `drain gBrMailbox`: with no page attached the ROM's out ring fills in a few seconds
// of link-battle traffic and BrNetlink stalls on a full ring; this plays the page's
// reader, taking every slot as it lands (outTail = outHead each frame).
static uint32_t drainAddr = 0;

// ---- the netlink stall guard ----------------------------------------------------
// A page reads the mailbox every frame. A driver that stages a link battle without
// `drain gBrMailbox` fills the ROM's out ring in a few seconds of block traffic, and
// from there BrNetlink_SendBlock can never hand another block over: gBrNetlink.pendingLen
// sticks, IsLinkTaskFinished() is false for ever, the battle controller's exec flags keep
// a transfer nobody will ever acknowledge, and the fight freezes mid-turn.
//
// On screen that is indistinguishable from a game bug, and it cost POK-312 a High ticket
// and most of a session. So the harness says which it is rather than running on in a ROM
// that is already dead.
#define STALL_LIMIT 300
static uint32_t netlinkAddr = 0;
static int netlinkLookedUp = 0;
static int stallFrames = 0;
static int stalled = 0;

static int findSym(const char* name, uint32_t* out) {
    for (int i = 0; i < nsyms; ++i)
        if (strcmp(syms[i].name, name) == 0) { *out = syms[i].addr; return 1; }
    return 0;
}

static void checkNetlinkStall(void) {
    if (!netlinkLookedUp) { netlinkLookedUp = 1; if (!findSym("gBrNetlink", &netlinkAddr)) netlinkAddr = 0; }
    if (!netlinkAddr || stalled) return;
    // struct BrNetlink: active at +0, pendingLen at +9 (include/br/br_netlink.h).
    if (core->busRead8(core, netlinkAddr) && core->busRead8(core, netlinkAddr + 9)) {
        if (++stallFrames < STALL_LIMIT) return;
        stalled = 1;
        printf("line %d: NETLINK STALLED -- gBrNetlink.pendingLen has held for %d frames.\n", lineNo, stallFrames);
        if (drainAddr)
            printf("  The out ring IS being drained, so this is not the usual cause: a block is stuck\n"
                   "  in BrWire_SendLarge. Read br_wire.c before believing the game froze.\n");
        else
            printf("  Nothing is reading the out ring, so it filled and the link battle is wedged.\n"
                   "  A page drains the mailbox every frame; a driver has to say so:\n"
                   "  put `drain gBrMailbox` at the top of this driver.\n");
    } else {
        stallFrames = 0;
    }
}

static void runN(int n) {
    for (int i = 0; i < n; ++i) {
        core->runFrame(core);
        if (drainAddr) core->busWrite16(core, drainAddr + 0xA, core->busRead16(core, drainAddr + 0x8));
        checkNetlinkStall();
    }
}

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

    char a[64], b[64], c[64], d[64], e[64];
    int n = sscanf(p, "%63s %63s %63s %63s %63s", a, b, c, d, e);
    if (n < 1) return 0;

    if (strcmp(a, "say") == 0) { printf("%s\n", p + 3 + (p[3] == ' ')); return 0; }
    if (strcmp(a, "wait") == 0 && n >= 2) { runN(atoi(b)); return 0; }
    if (strcmp(a, "drain") == 0 && n >= 2) { if (!parseAddr(b, &drainAddr)) return 4; printf("draining the out ring at 0x%08X\n", drainAddr); return 0; }
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
    if ((strcmp(a, "expect") == 0 || strcmp(a, "expectge") == 0 || strcmp(a, "expectle") == 0) && n >= 4) {
        int ge = a[6] == 'g', le = a[6] == 'l';
        int w = widthOf(b); uint32_t addr, want;
        if (!w || !parseAddr(c, &addr)) return 4;
        want = (uint32_t)strtoul(d, NULL, 0);
        uint32_t got = readW(w, addr);
        int bad = ge ? got < want : le ? got > want : got != want;
        if (bad) { printf("line %d: EXPECT FAILED %s at 0x%08X: got 0x%X want %s0x%X\n", lineNo, b, addr, got, ge ? ">= " : le ? "<= " : "", want); return 1; }
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
    if (strcmp(a, "mailsend") == 0 && n >= 5) {
        // The page's side of br_wire.c's framing: first slot [type][len][totalLen u16]
        // [seq 0][<=59 data], then continuations [type|0x80][len][seq][<=61 data].
        uint32_t box, src;
        int type = (int)strtoul(c, NULL, 0), len = atoi(e), sent = 0, i;
        uint8_t seq = 1;
        uint16_t head;
        uint8_t* buf;
        if (!parseAddr(b, &box) || !parseAddr(d, &src)) return 4;
        if (len < 0 || len > 0xFFFF) { printf("line %d: mailsend bad len %d\n", lineNo, len); return 4; }
        buf = malloc((size_t)len + 1);
        for (i = 0; i < len; ++i) buf[i] = core->busRead8(core, src + i);
        head = core->busRead16(core, box + 0x0C);
        {
            uint32_t slot = box + 0x1018 + (head % 64) * 64;
            core->busWrite8(core, slot + 0, (uint8_t)type);
            core->busWrite8(core, slot + 2, (uint8_t)(len & 0xFF));
            core->busWrite8(core, slot + 3, (uint8_t)(len >> 8));
            core->busWrite8(core, slot + 4, 0);
            for (i = 0; i < 59 && sent < len; ++i, ++sent)
                core->busWrite8(core, slot + 5 + i, buf[sent]);
            core->busWrite8(core, slot + 1, (uint8_t)(3 + i));
            head++;
        }
        while (sent < len) {
            uint32_t slot = box + 0x1018 + (head % 64) * 64;
            core->busWrite8(core, slot + 0, (uint8_t)(type | 0x80));
            core->busWrite8(core, slot + 2, seq++);
            for (i = 0; i < 61 && sent < len; ++i, ++sent)
                core->busWrite8(core, slot + 3 + i, buf[sent]);
            core->busWrite8(core, slot + 1, (uint8_t)(1 + i));
            head++;
        }
        core->busWrite16(core, box + 0x0C, head);
        free(buf);
        printf("mailsend type %d, %d bytes, inHead now %u\n", type, len, head);
        return 0;
    }
    if (strcmp(a, "copy") == 0 && n >= 4) {
        uint32_t dst, src; int len = atoi(d), i;
        if (!parseAddr(b, &dst) || !parseAddr(c, &src)) return 4;
        for (i = 0; i < len; ++i) core->busWrite8(core, dst + i, (uint8_t)core->busRead8(core, src + i));
        printf("copied %d bytes 0x%08X -> 0x%08X\n", len, src, dst);
        return 0;
    }
    if (strcmp(a, "pc") == 0) {
        uint32_t v = 0;
        static const char* rn[] = { "pc", "sp", "lr", "cpsr" };
        for (int i = 0; i < 4; ++i) {
            if (core->readRegister(core, rn[i], &v)) printf("%s=0x%08X ", rn[i], v);
        }
        printf("\n");
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
        if (!rc && stalled) rc = 5;
        fflush(stdout);
        if (rc) break;
    }
    fclose(f);
    printf(rc ? "FAIL (rc %d at line %d)\n" : "PASS\n", rc, lineNo);
    core->deinit(core);
    return rc;
}
