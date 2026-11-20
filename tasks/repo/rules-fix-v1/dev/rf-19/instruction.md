# Split not working with IF keywords inside BEGIN...END block

**Describe the bug**
sqlparse.split behaves incorrectly when IF keyword is present inside a BEGIN...END block

**To Reproduce**
An SQL statement passed to the `split` function
```
CREATE TASK t1 AS
BEGIN
    CREATE OR REPLACE TABLE temp1;
    DROP TABLE IF EXISTS temp1;
END;
EXECUTE TASK t1;
```
should result as two statements: `CREATE TASK...END;` and `EXECUTE TASK t1;`
But is resulting as a single statement

However, this issue is resolved as soon as the `IF` keyword is removed. For example,
```
CREATE TASK t1 AS
BEGIN
    CREATE OR REPLACE TABLE temp1;
    DROP TABLE temp1;
END;
EXECUTE TASK t1;
```
is working fine

**Versions (please complete the following information):**
 - Python: 3.9
 - sqlparse: 0.5.1

**Additional context**
This statement is used in Snowflake DB

Fix this issue in /work/repo.
