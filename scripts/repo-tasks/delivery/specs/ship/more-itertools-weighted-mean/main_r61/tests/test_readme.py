import re
from pathlib import Path
from unittest import TestCase

import more_itertools as mi

README = Path(__file__).resolve().parent.parent / 'README.rst'

# In __all__ on purpose, but not functions the README's table lists:
# an exception, a result type, a deprecated function, an old alias and a
# helper.
UNLISTED = {'AbortThread', 'Stats', 'callback_iter', 'padnone', 'raise_'}


class ReadmeTests(TestCase):
    def test_every_public_function_is_listed(self):
        text = README.read_text(encoding='utf-8')
        listed = set(re.findall(r'api\.html#more_itertools\.(\w+)>', text))
        public = set(mi.more.__all__) | set(mi.recipes.__all__)
        self.assertEqual(sorted(public - UNLISTED - listed), [])
