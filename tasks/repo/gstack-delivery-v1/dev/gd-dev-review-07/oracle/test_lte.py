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
    for age in (20, 30, 40):
        User.create(username='u%s' % age, age=age)


def test_lte_includes_the_value():
    assert names({'age__lte': '30'}) == ['u20', 'u30']
    assert names({'age__gte': '30'}) == ['u30', 'u40']
