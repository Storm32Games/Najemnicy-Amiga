# Port Najemników na A1200 + PiStorm (C99 + miniGL).
# Dane: node tools/amiga/gen_headers.ts (nagłówki C) i node tools/amiga/export_data.ts (JSON, wektory testowe).

CFLAGS_COMMON = -std=c99 -Wall -Wextra -pedantic -Werror
M68K_CC ?= m68k-amigaos-gcc
M68K_FLAGS = -m68020 -O2 -noixemul

DATA = src/data/gamedata.c

.PHONY: test m68k clean

# natywny test tabel
test: build/test_gamedata
	./build/test_gamedata

build/test_gamedata: tests/test_gamedata.c $(DATA) src/data/gamedata.h
	mkdir -p build
	$(CC) $(CFLAGS_COMMON) -O2 -o $@ tests/test_gamedata.c $(DATA)

# ten sam test skompilowany pod 68020 (uruchomić na Amidze / w emulatorze)
m68k: build/test_gamedata.68k

build/test_gamedata.68k: tests/test_gamedata.c $(DATA) src/data/gamedata.h
	mkdir -p build
	$(M68K_CC) $(CFLAGS_COMMON) $(M68K_FLAGS) -o $@ tests/test_gamedata.c $(DATA)

clean:
	rm -rf build
