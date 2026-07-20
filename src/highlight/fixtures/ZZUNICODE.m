ZZUNICODE ; the column-unit oracle: non-ASCII BEFORE captured tokens
 ; A column in UTF-8 bytes and a column in UTF-16 code units are DIFFERENT
 ; numbers on every line below. Keep this file non-ASCII — a guard assertion
 ; in wasm.test.ts reds if it is ever "simplified" back to plain ASCII.
 ;
 set two="é",alpha=1
 set three="€",beta=2
 set four="😀",gamma=3
 set mixed="é€😀",delta=4 ; trailing comment
 quit
