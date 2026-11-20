# IndexError on empty tables when `maxheadercolwidths` is used

Whenever the parameter `maxheadercolwidths` is not None, an IndexError is raised when trying to print an empty table

The issue specifically is here:
https://github.com/astanin/python-tabulate/blob/master/tabulate/__init__.py#L2253

```
if maxheadercolwidths is not None:
    num_cols = len(list_of_lists[0])
```
where with an empty table `list_of_lists` is empty

Fix this issue in /work/repo.
