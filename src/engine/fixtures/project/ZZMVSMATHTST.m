ZZMVSMATHTST ; m-vscode P4 fixture test suite
 ;; tier: unit
 ; m-lint: disable-file=M-MOD-020
 new pass,fail
 do start^STDASSERT(.pass,.fail)
 do tAdd(.pass,.fail)
 do tDbl(.pass,.fail)
 do report^STDASSERT(pass,fail)
 quit
 ;
tAdd(pass,fail) ; add
 do eq^STDASSERT(.pass,.fail,$$add^ZZMVSMATH(1,2),3,"1+2=3")
 do eq^STDASSERT(.pass,.fail,$$add^ZZMVSMATH(-1,1),0,"-1+1=0")
 quit
 ;
tDbl(pass,fail) ; dbl
 do eq^STDASSERT(.pass,.fail,$$dbl^ZZMVSMATH(5),10,"5*2=10")
 quit
