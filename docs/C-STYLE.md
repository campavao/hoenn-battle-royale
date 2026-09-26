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
  outside the ROM. A field of one of pret's structs the page reads is pinned the same
  way in `src/br/br_pins.c`, since pret's headers are not ours to add to; for a bitfield,
  pin the plain fields either side of its run. web/src/parity.test.ts fails on an offset
  the page derives that is not pinned there.
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
  specials go at the end of `data/specials.inc`, so pret's keep their numbers, and a
  changed graphic is a new file picked under `#if BR`, never an edit to pret's.
- **Outside the guards a pret file is pret's, line for line.** `tools/br/pret-intact.py`
  (the same job) takes the BR branches and guard lines out of every pret file we touch
  and fails unless what is left is pret's file at `tools/br/BASELINE_COMMIT`. So a hook
  that adds to a pret line keeps pret's whole line under `#else` (a trailing comma, a
  condition: `#if BR` / our line / `#else` / pret's line / `#endif`), a hook that
  wraps pret's lines opens and closes its braces inside two guards and leaves the lines
  between them alone, and the blank line that sets a BR block apart goes inside its
  guard, before the `#endif`.
- **`make BR=0` is retail.** It leaves `src/br` out, builds into `build/pret`, and
  `tools/br/check-rom.sh pokeemerald_pret.gba` must print OK; CI's `pret` job builds it
  on every tag, and a release waits for it. The two scripts see names and lines; this
  sees bytes, so run it after touching a pret file.
- **Strings.** Game text is in the Gen 3 charmap (`_("...")` in C, `.string` in scripts).
  Plain C strings are only for `gBrVersionString`-style ROM markers.
- **Names.** `Br<System>_<Verb>` for functions (`BrMailbox_Push`), `gBr*` for globals
  (the symbol exporter picks those up), `BR_*` for macros.
- **A driver per change.** Every behaviour lands with a `tools/br/drivers/*.txt` that
  asserts it through RAM, and the driver is in the commit.
