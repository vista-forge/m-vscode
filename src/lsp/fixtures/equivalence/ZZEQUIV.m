ZZEQUIV ;equivalence fixture ; deliberately non-canonical
START N X S X=1 I X=1 W "hi",! Q
 ;
LOOP F I=1:1:3 D  W I,!
 . S X=X+1
 D SUB^ZZOTHER
 Q
SUB(A,B) ;
 Q A+B
