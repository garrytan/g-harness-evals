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
    for i in range(10):
        User.create(username='u%s' % i, age=i)


def test_per_page_is_capped():
    assert len(names({'per_page': '50'}, max_per_page=5)) == 5
    assert len(names({'per_page': '3'}, max_per_page=5)) == 3
