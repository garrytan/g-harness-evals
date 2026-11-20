# `OneOf.options()` emits extra pairs when labels outnumber choices

`marshmallow.validate.OneOf.options()` is supposed to “return the (value, label) pairs, where value is a string associated with each choice.” However the implementation zips `choices` and `labels` with `zip_longest(..., fillvalue="")`, so it produces as many pairs as the longer input. When `labels` is longer than `choices`, `options()` yields phantom entries whose value is the empty string, even though no such choice exists. 
Better to raise a ValueErorr?

```python
from marshmallow.validate import OneOf

oneof = OneOf(choices=[], labels=["extra"])
print(list(oneof.options()))
# Expected: []
# Actual: [('', 'extra')]  # bogus option with empty string value
```

> Note: This issue was identified by an automated testing tool for academic research and manually verified. If you have any concerns about this type of reporting, please let me know, and I will adjust my workflow accordingly.

Fix this issue in /work/repo.
