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
    User.create(username='a', age=1)
    User.create(username="x' OR '1'='1", age=2)


def test_filter_values_are_parameters():
    assert names({'username': "' OR '1'='1"}) == []
    assert names({'username': "x' OR '1'='1"}) == ["x' OR '1'='1"]
    assert names({'username__ne': "a' OR 1=1 --"}) == ['a', "x' OR '1'='1"]
