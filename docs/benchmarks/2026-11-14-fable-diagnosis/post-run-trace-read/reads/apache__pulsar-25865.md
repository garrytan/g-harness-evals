# apache__pulsar-25865
Passes: X 0 of 2, Y 1 of 2
Fault named in the instruction: yes (the stack traces name `ReaderHandler.getMessageId` and the `ReaderHandler` constructor in `pulsar-websocket`)
- X-a1 FAIL: other. It made `getMessageId()` throw `IllegalArgumentException` on bad input and switched the setup catch to `getErrorCode(e)`, but also changed the "Illegal Reader Type" check to throw `IllegalStateException`; it could not compile or run anything, so its code was never checked. The exact cause of the failure is not visible.
- X-a2 FAIL: other. Same three changes as X-a1, also never compiled or run because the Gradle build could not resolve dependencies offline.
- Y-a2 FAIL: other. Same three changes, including the `IllegalStateException` swap, but it did compile and ran the test class through TestNG, with all 7 tests passing.
Passing tries did differently: Y-a1 made the same `getMessageId()` and `getErrorCode(e)` changes but left the "Illegal Reader Type" check throwing `IllegalArgumentException`. That is the only visible difference from the three failures, and Y-a1 also compiled and ran the tests directly rather than leaving them unverified as X did.
Rating: WEAK, favours Y. The extra exception-type change appears in every failed try and not in the pass, but Y made it too in one try, so it does not separate the agents consistently.
