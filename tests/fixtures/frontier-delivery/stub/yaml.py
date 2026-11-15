import json


def safe_dump(data, sort_keys=False):
    return json.dumps(data, sort_keys=sort_keys) + "\n"
