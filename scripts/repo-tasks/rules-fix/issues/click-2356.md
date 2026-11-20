# `show_choices=False` seems to have no effect

I noticed when using Typer that even if you pass `show_choices=False`, the choices still get shown in the help. It seems that this is related to Click.

Example:
```python
import click

@click.command()
@click.option('-s', '--string-to-echo', type=click.Choice(['hello', 'world']), show_choices=False)
def echo(string):
    click.echo(string)

if __name__ == "__main__":
    echo()
```
```
Usage: ... [OPTIONS]

Options:
  -s, --string-to-echo [hello|world]
  --help                          Show this message and exit.
```

I guess it isn't documented what `show_choices` does for `Option` (if anything) in the non-prompt case, but I expected `show_choices=False` to disable showing the choices in the help.

Environment:

- Python version: 3.9.13
- Click version: 8.1.3
