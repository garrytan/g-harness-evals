# floci-io__floci-1325
Passes: X 2 of 2, Y 0 of 2
Fault named in the instruction: partly (it names the behaviour and the InvalidKey error, not S3Controller.validateRawUri, which all four tries changed)
- Y-a1 FAIL: right place but incomplete or wrong fix. A one-line change in validateRawUri to throw a bodiless 400; it chose to keep InvalidKey for the encoded-slash form (%2E%2E%2Fsecret.txt) and left the existing test for it unchanged, and left the object handlers, HEAD and virtual-host paths unchecked.
- Y-a2 FAIL: right place but incomplete or wrong fix. Added a new S3DotDotPathFilter that covers every route and virtual-host requests, but it too deliberately kept InvalidKey for the %2E%2E%2F encoded-slash key and kept that existing test expecting InvalidKey.
Passing tries did differently: both X tries made every decoded dot-dot that climbs above the bucket, including %2E%2E%2Fsecret.txt, return the empty 400, updated the existing encoded-slash test to expect an empty body, and ran the check in the object handlers too (blocking a cross-bucket write).
Rating: STRONG, favours X. All four tries split on the same choice (empty 400 for the encoded-slash traversal key or not), and that is the most likely visible cause of the grades, though the hidden tests themselves are not visible.
