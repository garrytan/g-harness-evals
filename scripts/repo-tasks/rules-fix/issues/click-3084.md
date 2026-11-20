# Bug: Optional value not optional anymore

### Outline

As stated in [official documentation](https://click.palletsprojects.com/en/stable/options/#optional-value): 
> Setting `is_flag=False, flag_value=value` tells Click that the option can still be passed a value, but if only the flag is given, the value will be `flag_value`.

Since 8.3.0 this doesn't work anymore, instead `SystemExit` with "Error: Option '--xyz' requires an argument." is thrown.

### Replication of bug

Example taken from documentation:
```python
@click.command()
@click.option("--name", is_flag=False, flag_value="Flag", default="Default")
def hello(name):
    click.echo(f"Hello, {name}!")
```

```shell
$ hello --name
Error: Option '--name' requires an argument.
```

### Expected behavior

The code example above should work as
```shell
$ hello --name
Hello, Flag!
```

It's not even working in the generated documentation anymore: while [documentation up to Sep, 10th](https://web.archive.org/web/20250910222023/https://click.palletsprojects.com/en/stable/options/#optional-value) shows the expected and correct behavior, [current documentation](https://click.palletsprojects.com/en/stable/options/#optional-value) demonstrates the bug.

- Python version: 3.11
- Click version: 8.3.0
