"""
Filter, search, sort and paginate a query from request arguments, such as the
query string of a list endpoint.

Example::

    from playhouse.query_args import apply_args

    @app.route('/users/')
    def users():
        query = apply_args(User.select(), request.args,
                           fields=[User.username, User.age, User.joined],
                           search=[User.username, User.bio])
        return render_template('users.html', users=query)

Every argument is optional:

* ``<field>=<value>`` or ``<field>__<op>=<value>`` keeps the rows that match.
  The operators are eq, ne, lt, lte, gt and gte, in (a comma-separated list
  of values) and isnull (true or false). An empty value is ignored, as
  browsers send empty form fields.
* ``q`` keeps the rows where any of the search fields contains the text,
  ignoring case. The text is matched literally.
* ``sort`` is a comma-separated list of field names, each prefixed with
  ``-`` for descending order.
* ``page`` counts from 1, and ``per_page`` is capped at ``max_per_page``.

Only the fields in ``fields`` can be filtered or sorted on. Any other name,
an unknown operator or a value that is not valid raises ValueError, which a
view can turn into a 400 response.
"""
import operator
from functools import reduce


OPS = {
    'eq': operator.eq,
    'ne': operator.ne,
    'lt': operator.lt,
    'lte': operator.lt,
    'gt': operator.gt,
    'gte': operator.ge,
}

RESERVED = ('q', 'sort', 'page', 'per_page')


def _search(fields, text):
    return reduce(operator.or_, [field.contains(text) for field in fields])


def apply_args(query, args, fields, search=None, per_page=20,
               max_per_page=100):
    """
    Return the query filtered, searched, sorted and paginated by ``args``.

    :param query: a select query.
    :param args: a mapping of argument names to string values.
    :param fields: the fields that can be filtered and sorted on.
    :param search: the fields that ``q`` searches.
    :param int per_page: rows per page when ``per_page`` is not given.
    :param int max_per_page: the most rows a page can have.
    """
    allowed = dict((field.name, field) for field in fields)

    for key, value in args.items():
        if key in RESERVED or value == '':
            continue
        name, _, op = key.partition('__')
        if name not in allowed:
            raise ValueError('Cannot filter on %r.' % name)
        query = query.where(_filter(allowed[name], op or 'eq', value))

    if args.get('q') and search:
        query = query.where(_search(search, args['q']))

    ordering = []
    for name in filter(None, args.get('sort', '').split(',')):
        field = query.model._meta.fields.get(name.lstrip('-'))
        if field is None:
            raise ValueError('Cannot sort on %r.' % name)
        ordering.append(field.desc() if name.startswith('-') else field)
    if ordering:
        query = query.order_by(*ordering)

    page = _positive(args, 'page', 1)
    per_page = _positive(args, 'per_page', min(per_page, max_per_page))
    return query.paginate(page, per_page)


def _filter(field, op, value):
    if op in OPS:
        return OPS[op](field, value)
    if op == 'in':
        return field.in_(value.split(','))
    if op != 'isnull':
        raise ValueError('Unknown operator %r.' % op)
    if value not in ('true', 'false'):
        raise ValueError('isnull takes true or false, not %r.' % value)
    return field.is_null(value)


def _positive(args, name, default):
    value = args.get(name)
    if value is None or value == '':
        return default
    try:
        value = int(value)
    except ValueError:
        raise ValueError('%s must be a whole number, not %r.' % (name, value))
    if value < 1:
        raise ValueError('%s must be at least 1.' % name)
    return value
