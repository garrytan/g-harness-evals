from peewee import CharField
from peewee import IntegerField
from peewee import Model
from peewee import SqliteDatabase
from peewee import TextField
from playhouse.query_args import apply_args

db = SqliteDatabase(':memory:')


class User(Model):
    username = CharField()
    age = IntegerField()
    bio = TextField(null=True)
    password = CharField(default='')

    class Meta:
        database = db


def names(args, **kwargs):
    kwargs.setdefault('fields', [User.username, User.age, User.bio])
    kwargs.setdefault('search', [User.username, User.bio])
    query = apply_args(User.select().order_by(User.id), args, **kwargs)
    return [user.username for user in query]


def setup_module():
    db.create_tables([User])
    for name in ('a_b', 'axb', '100%', '1000'):
        User.create(username=name, age=1)


def test_search_text_is_matched_literally():
    assert names({'q': '_'}) == ['a_b']
    assert names({'q': '%'}) == ['100%']
