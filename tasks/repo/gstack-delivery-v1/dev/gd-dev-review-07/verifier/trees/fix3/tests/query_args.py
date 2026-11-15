from peewee import CharField
from peewee import IntegerField
from peewee import TextField
from playhouse.query_args import apply_args

from .base import ModelTestCase
from .base import TestModel


class Member(TestModel):
    username = CharField()
    age = IntegerField()
    bio = TextField(null=True)


class TestQueryArgs(ModelTestCase):
    requires = [Member]

    def setUp(self):
        super(TestQueryArgs, self).setUp()
        for username, age, bio in (('huey', 12, 'Likes naps.'),
                                   ('mickey', 7, None),
                                   ('zaizee', 9, 'Chases huey.'),
                                   ('beanie', 3, 'New here.')):
            Member.create(username=username, age=age, bio=bio)

    def names(self, args, **kwargs):
        kwargs.setdefault('fields', [Member.username, Member.age])
        kwargs.setdefault('search', [Member.username, Member.bio])
        query = apply_args(Member.select().order_by(Member.id), args,
                           **kwargs)
        return [member.username for member in query]

    def test_filters(self):
        self.assertEqual(self.names({'username': 'huey'}), ['huey'])
        self.assertEqual(self.names({'age__gt': '7'}), ['huey', 'zaizee'])
        self.assertEqual(self.names({'age__lt': '7'}), ['beanie'])
        self.assertEqual(self.names({'age__gte': '9', 'age__ne': '12'}),
                         ['zaizee'])
        self.assertEqual(self.names({'username__in': 'mickey,beanie'}),
                         ['mickey', 'beanie'])
        self.assertEqual(self.names({'username': ''}),
                         ['huey', 'mickey', 'zaizee', 'beanie'])

    def test_search(self):
        self.assertEqual(self.names({'q': 'HUEY'}), ['huey', 'zaizee'])
        self.assertEqual(self.names({'q': 'naps'}), ['huey'])
        self.assertEqual(self.names({'q': 'huey'}, search=None),
                         ['huey', 'mickey', 'zaizee', 'beanie'])

    def test_sort(self):
        self.assertEqual(self.names({'sort': 'username'}),
                         ['beanie', 'huey', 'mickey', 'zaizee'])
        self.assertEqual(self.names({'sort': '-age'}),
                         ['huey', 'zaizee', 'mickey', 'beanie'])

    def test_pages(self):
        self.assertEqual(self.names({'per_page': '3'}),
                         ['huey', 'mickey', 'zaizee'])
        self.assertEqual(self.names({'per_page': '3', 'page': '2'}),
                         ['beanie'])
        self.assertEqual(self.names({}, per_page=2), ['huey', 'mickey'])

    def test_errors(self):
        self.assertRaises(ValueError, self.names, {'bio': 'x'})
        self.assertRaises(ValueError, self.names, {'age__like': '1'})
        self.assertRaises(ValueError, self.names, {'sort': 'nope'})
        self.assertRaises(ValueError, self.names, {'page': '0'})
        self.assertRaises(ValueError, self.names, {'per_page': 'all'})
        self.assertRaises(ValueError, self.names, {'age__isnull': 'yes'})
