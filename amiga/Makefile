# Port Najemników na A1200 + PiStorm (C99 + miniGL).
# Dane, wektory i ślady referencyjne (po zmianie src/core):
#   node tools/amiga/export_data.ts && node tools/amiga/gen_headers.ts && node tools/amiga/gen_test_vectors.ts
#   node tools/amiga/trace_rules.ts && node tools/amiga/trace_tactical.ts && node tools/amiga/trace_campaign.ts

CFLAGS_COMMON = -std=c99 -Wall -Wextra -pedantic -Werror
M68K_CC ?= m68k-amigaos-gcc
# soft-float: obliczenia double jak w JS (IEEE 754), bez FPU
M68K_FLAGS = -m68020 -msoft-float -O2 -noixemul
LIBS = -lm

DATA = src/data/gamedata.c
CORE = $(wildcard src/core/*.c)
HDRS = src/data/gamedata.h $(wildcard src/core/*.h)
TESTS = test_gamedata test_dice test_character
TRACES = $(patsubst data/traces/%.txt,%,$(wildcard data/traces/*.txt))

.PHONY: test traces m68k clean

# natywnie: testy jednostkowe + porównanie śladów C z TS
test: $(TESTS:%=build/%) traces
	@for t in $(TESTS); do ./build/$$t || exit 1; done

traces: $(TRACES:%=build/trace_%)
	@for t in $(TRACES); do \
	  ./build/trace_$$t > build/$$t.txt || exit 1; \
	  if cmp -s build/$$t.txt data/traces/$$t.txt; then echo "trace $$t: zgodny ($$(wc -l < data/traces/$$t.txt) linii)"; \
	  else echo "trace $$t: ROZBIEZNOSC"; diff build/$$t.txt data/traces/$$t.txt | head -20; exit 1; fi; done

build/test_%: tests/test_%.c $(CORE) $(DATA) $(HDRS) $(wildcard tests/*.h)
	@mkdir -p build
	$(CC) $(CFLAGS_COMMON) -O2 -o $@ $< $(CORE) $(DATA) $(LIBS)

build/trace_%: tests/trace_%.c tests/trace_fmt.c tests/trace_fmt.h $(CORE) $(DATA) $(HDRS)
	@mkdir -p build
	$(CC) $(CFLAGS_COMMON) -O2 -o $@ $< tests/trace_fmt.c $(CORE) $(DATA) $(LIBS)

# te same programy pod 68020 (uruchomić na Amidze / w emulatorze)
m68k: $(TESTS:%=build/%.68k) $(TRACES:%=build/trace_%.68k)

build/test_%.68k: tests/test_%.c $(CORE) $(DATA) $(HDRS)
	@mkdir -p build
	$(M68K_CC) $(CFLAGS_COMMON) $(M68K_FLAGS) -o $@ $< $(CORE) $(DATA) $(LIBS)

build/trace_%.68k: tests/trace_%.c tests/trace_fmt.c $(CORE) $(DATA) $(HDRS)
	@mkdir -p build
	$(M68K_CC) $(CFLAGS_COMMON) $(M68K_FLAGS) -o $@ $< tests/trace_fmt.c $(CORE) $(DATA) $(LIBS)

clean:
	rm -rf build
