# bug: `/#/` in URLs is failing validation

Hi there, 
following https://github.com/python-validators/validators/issues/285 's report, we also saw a regression on testing validity or a URL, namely `https://exchange.jetswap.finance/#/swap` ( `ValidationError(func=url, args={'value': 'https://exchange.jetswap.finance/#/swap'})`

The `/#/` in there is probably the thing making it match as invalid, sadly it is a common side-effect of some JS UI libraries.

As the last comments mention, it would indeed be super nice to follow the common semver practice in bumping a `major` version in case of breaking change, and at least mention in the [releases description](https://github.com/python-validators/validators/releases) when a breaking change is included. 🙏

Fix this issue in /work/repo.
