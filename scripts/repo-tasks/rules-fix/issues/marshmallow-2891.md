# ValidationError with uppercase `file` URLs

## Issue Description
I noticed that when a file URL uses an uppercase scheme (FILE), fields.Url raises a ValidationError, even though the exact same URL with a lowercase scheme (file) works fine. Since URL schemes are  case-insensitive, I’d expect either both to be accepted or both to be rejected.

For example, HTTPS:// and https:// both work without any issues. This seems related to marshmallow issue #2249 and PR #2800. I’m happy to open a PR to fix this if it makes sense.

## Reproducing Code Example

```
from marshmallow import Schema, fields

class MySchema(Schema):
    url = fields.Url(schemes={"file"})

MySchema().load({"url": "FILE:///path/to/somefile.txt"})
```

## Expected Result
```
{"url": "FILE:///path/to/somefile.txt"}
```
## Actual Behavior
```
Traceback (most recent call last):
  File "test.py", line 6, in <module>
    MySchema().load({"url": "FILE:///path/to/somefile.txt"})
  File ".../site-packages/marshmallow/schema.py", line 730, in load
    return self._do_load(
  File ".../site-packages/marshmallow/schema.py", line 938, in _do_load
    raise exc marshmallow.exceptions.ValidationError: {'url': ['Not a valid URL.']}
```
