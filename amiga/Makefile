# Port Najemników na A1200 + PiStorm (C99 + miniGL).
# Dane i wektory (po zmianie src/core):
#   node tools/amiga/export_data.ts && node tools/amiga/gen_headers.ts && node tools/amiga/gen_test_vectors.ts

CFLAGS_COMMON = -std=c99 -Wall -Wextra -pedantic -Werror
M68K_CC ?= m68k-amigaos-gcc
M68K_FLAGS = -m68020 -O2 -noixemul

DATA = src/data/gamedata.c
CORE = src/core/rng.c src/core/dice.c src/core/stats.c src/core/character.c
HDRS = src/data/gamedata.h src/core/rng.h src/core/dice.h src/core/character.h
TESTS = test_gamedata test_dice test_character

.PHONY: test m68k clean

# natywnie: budowa i uruchomienie wszystkich testów
test: $(TESTS:%=build/%)
	@for t in $(TESTS); do ./build/$$t || exit 1; done

build/test_gamedata: tests/test_gamedata.c $(DATA) $(HDRS)
	@mkdir -p build
	$(CC) $(CFLAGS_COMMON) -O2 -o $@ tests/test_gamedata.c $(DATA)

build/test_dice: tests/test_dice.c tests/vectors_dice.h $(CORE) $(DATA) $(HDRS)
	@mkdir -p build
	$(CC) $(CFLAGS_COMMON) -O2 -o $@ tests/test_dice.c $(CORE) $(DATA)

build/test_character: tests/test_character.c tests/vectors_char.h $(CORE) $(DATA) $(HDRS)
	@mkdir -p build
	$(CC) $(CFLAGS_COMMON) -O2 -o $@ tests/test_character.c $(CORE) $(DATA)

# te same testy pod 68020 (uruchomić na Amidze / w emulatorze)
m68k: $(TESTS:%=build/%.68k)

build/test_gamedata.68k: tests/test_gamedata.c $(DATA) $(HDRS)
	@mkdir -p build
	$(M68K_CC) $(CFLAGS_COMMON) $(M68K_FLAGS) -o $@ tests/test_gamedata.c $(DATA)

build/test_dice.68k: tests/test_dice.c tests/vectors_dice.h $(CORE) $(DATA) $(HDRS)
	@mkdir -p build
	$(M68K_CC) $(CFLAGS_COMMON) $(M68K_FLAGS) -o $@ tests/test_dice.c $(CORE) $(DATA)

build/test_character.68k: tests/test_character.c tests/vectors_char.h $(CORE) $(DATA) $(HDRS)
	@mkdir -p build
	$(M68K_CC) $(CFLAGS_COMMON) $(M68K_FLAGS) -o $@ tests/test_character.c $(CORE) $(DATA)

clean:
	rm -rf build
