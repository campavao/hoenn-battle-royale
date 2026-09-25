# C in src/br/

The release ROM is built by agbcc, a GCC 2.95. Write for it; the modern build is the
lenient one.

- **C89 shapes.** Declarations at the top of a block, before any statement. No `//` at the
  end of a macro line. No designated initialisers (`{ .x = 1 }`), no compound literals, no
  variable-length arrays, no `inline`. `for (i = 0; ...)` with `i` declared above.
- **Types.** `u8 u16 u32 s8 s16 s32 bool8` from `global.h`. No `int` in structs that cross
  the mailbox: the shell reads the layout byte for byte, so every field has an explicit
  width and the struct is laid out by hand with alignment in mind (a `u32` on a 4-byte
  boundary, `u16` on 2). No floats anywhere.
- **RAM.** `EWRAM_DATA` for anything the shell reads. Never `static` inside a function
  for match state: the shell cannot find it. IWRAM is scarce; keep it for the engine.
  EWRAM is nearly full: `tools/br/ram-headroom.py <map>` prints what is left, and CI
  fails a build with under 128 bytes of it. A string built and handed straight to
  `BrHud_Say` belongs on the stack, not in a static.
- **Heap for staging only.** Fixed arrays sized by `br_config.h` for state. A buffer that
  only lives between a message's first slot and its last (a bot's card, a duel, a
  bstart, a START) may go on the heap: `Alloc` on the first slot, `Free` once parsed, and
  a `Br<System>_HeapReset` called from `InitHeap` (src/malloc.c) that drops the pointer,
  because `CB2_InitBattle` resets the heap on the way into every battle. Nothing that
  must outlive that goes there.
- **Per-frame work goes through `BrFrame`.** The main loop calls it after `ReadKeys`,
  in every state (title, overworld, battle, menus), so nothing needs a `Task` to stay
  alive across a map load. Register a system's tick from `BrFrame`; use a `Task` only for
  something that should stop when the engine wipes tasks. Do not hang state on a task's
  `data[]` if the shell needs it; put it in the mailbox.
- **Upstream touches.** One `#if BR` block per site, calling one function in `src/br/`.
  Never reindent or reflow upstream code around the hook. The build must still match the
  retail sha1 with `BR` defined to 0.
- **Strings.** Game text is in the Gen 3 charmap (`_("...")` in C, `.string` in scripts).
  Plain C strings are only for `gBrVersionString`-style ROM markers.
- **Names.** `Br<System>_<Verb>` for functions (`BrMailbox_Push`), `gBr*` for globals
  (the symbol exporter picks those up), `BR_*` for macros.
- **A driver per change.** Every behaviour lands with a `tools/br/drivers/*.txt` that
  asserts it through RAM, and the driver is in the commit.
