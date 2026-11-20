# Weird parsing for `NULLS LAST`

I'm not sure what the proper parsing should be exactly, but I don't think this is it.  The way it parsed the various NULL, NULLs, FIRST, LAST that are identifier modifiers is inconsistent and hard to use.

Ideally for my use case, the whole ORDER BY clause would be a single IdentifierList and none of those would be Keyword, but I don't know if that's right or not.

Related to #487.  

```
sql1 = "SELECT *, NULL as null_col FROM mytable ORDER BY [name] ASC NULLS LAST, [number] DESC NULLS FIRST"

for token in sqlparse.parse(sql1)[0]:
    if token.ttype == T.Whitespace:
        continue
    print(f"{str(token.ttype or token.__class__):40s} {token.value}")
```

gives this output:

```
<class 'sqlparse.sql.IdentifierList'>    *, NULL as null_col
Token.Keyword                            FROM
<class 'sqlparse.sql.Identifier'>        mytable
Token.Keyword                            ORDER BY
<class 'sqlparse.sql.Identifier'>        [name] ASC NULLS
<class 'sqlparse.sql.IdentifierList'>    LAST, [number] DESC NULLS
Token.Keyword                            FIRST
```

Fix this issue in /work/repo.
