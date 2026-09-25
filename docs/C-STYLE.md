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
- **Pin what the shell reads.** Every field the page or a driver reads by offset gets a
  `BR_OFFSET(Struct, field, off)` right under the struct (br_config.h), so moving it
  fails both builds. Offsets agree between the compilers; sizes do not always: agbcc
  rounds every struct up to a whole word, so a 6-byte struct is 8 in the release ROM and
  an array of them strides differently in the two builds. `BR_SIZE` only for sizes that
  are already a multiple of 4, and never stride an array of an odd-sized struct from
  outside the ROM.
- **RAM.** `EWRAM_DATA` for anything the shell reads. Never `static` inside a function
  for match state: the shell cannot find it. IWRAM is scarce; keep it for the engine.
  EWRAM is nearly full: `tools/br/ram-headroom.py <map>` prints what is left, and CI
  fails a build with under 128 bytes of it. A string built and handed straight to
  `BrHud_Say` belongs on the stack, not in a static.
- **The heap is the next battle's.** Fixed arrays sized by `br_config.h` for state. A
  buffer may go on the heap -- a message being assembled (a bot's card, a duel, a
  bstart, a START), a spectator's parties waiting on the fade -- but `CB2_InitBattle`
  re-initialises the heap on the way into every battle. So any `Alloc` kept past the
  frame it was made in must be released in `BrHeapReset` (br_main.c, called from
  `InitHeap`): give the module a `Br<System>_HeapReset` that drops the pointer and add
  it there. Nothing that must outlive a battle goes on the heap.
- **Per-frame work goes through `BrFrame`.** The main loop calls it after `ReadKeys`,
  in every state (title, overworld, battle, menus), so nothing needs a `Task` to stay
  alive across a map load. Register a system's tick from `BrFrame`; use a `Task` only for
  something that should stop when the engine wipes tasks. Do not hang state on a task's
  `data[]` if the shell needs it; put it in the mailbox.
- **Upstream touches.** One `#if BR` block per site (`.if BR` in assembler), calling one
  function in `src/br/`. When a hook replaces pret's lines, pret's lines stay under the
  block's `#else`, word for word. Never `#ifdef BR`: the Makefile always defines BR
  (`BR ?= 1`), so that is on even in `make BR=0`. Never reindent or reflow upstream code
  around the hook. `tools/br/check-guards.py` (CI's `guards` job) fails on any
  `Br*`/`gBr*`/`BR_*` name or `br/` include outside a guard, comments included. BR's own
  specials go at the end of `data/specials.inc`, so pret's keep their numbers.
- **Strings.** Game text is in the Gen 3 charmap (`_("...")` in C, `.string` in scripts).
  Plain C strings are only for `gBrVersionString`-style ROM markers.
- **Names.** `Br<System>_<Verb>` for functions (`BrMailbox_Push`), `gBr*` for globals
  (the symbol exporter picks those up), `BR_*` for macros.
- **A driver per change.** Every behaviour lands with a `tools/br/drivers/*.txt` that
  asserts it through RAM, and the driver is in the commit.
