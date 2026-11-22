# Leak preflight, split dev

Layout: the two arms served the same manifest and ingest tokens from one image.

## Open arm (scope open), split dev

Image `harness-eval/gbrain:stable-98dda48fb9fd` sha256:23a3436069e4d33225963e19287886754481f4ed1766f21f70312ee2aa5861f5, gbrain 98dda48fb9fd339609d6d4eef009811280ff648d. PASS. 22 scripted facts (0 held only in the database, no page), 16 askers, 1394 calls. Manifest sha256 `44f3aef1a395f388`, ingest tokens sha256 `faddda0ece23c7a6`.

| Asker | Token | search | query | recall | get_page | list_pages | hot memory | list rows outside grant |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| anselm-grieve | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| bettina-kroll | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| dana-okafor | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| gideon-sato | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| hollis-mbeki | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| ilse-varga | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| june-osei | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| kwame-adjei | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| marcus-lindqvist | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| moss | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| nadia-fennimore | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| pree-sundaram | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| ruth-calloway | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| sofia-marchetti | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| tobias-rendle | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |
| public-only | trial-leak-preflight-open-dev | 22 | 22 | 22 | 22 | 22 | 0 | 0 |

Cells count the scripted facts whose marker came back (get_page and list_pages: whose page was served or listed).

Informational `write_carry_member_only` (recorded, never a failure): put_page landed, crossed to bob:search, bob:query, bob:recall, bob:get_page, bob:list_pages, public:search, public:query, public:recall, public:get_page, public:list_pages; remember landed, crossed to nobody.

Informational `write_carry_attested_actor` (recorded, never a failure): may_act_for put_page landed, crossed to bob:search, bob:query, bob:recall, bob:get_page, bob:list_pages, public:search, public:query, public:recall, public:get_page, public:list_pages; attested_actor put_page landed, crossed to bob:search, bob:query, bob:recall, bob:get_page, bob:list_pages, public:search, public:query, public:recall, public:get_page, public:list_pages.

## Rules arm (scope member-sources), split dev

Image `harness-eval/gbrain:stable-98dda48fb9fd` sha256:23a3436069e4d33225963e19287886754481f4ed1766f21f70312ee2aa5861f5, gbrain 98dda48fb9fd339609d6d4eef009811280ff648d. PASS. 22 scripted facts (0 held only in the database, no page), 16 askers, 1540 calls. Manifest sha256 `44f3aef1a395f388`, ingest tokens sha256 `faddda0ece23c7a6`.

| Asker | Token | search | query | recall | get_page | list_pages | hot memory | list rows outside grant |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| anselm-grieve | member-anselm-grieve | 4 | 4 | 4 | 4 | 4 | 3 | 0 |
| bettina-kroll | member-bettina-kroll | 2 | 2 | 2 | 2 | 2 | 1 | 0 |
| dana-okafor | member-dana-okafor | 5 | 5 | 5 | 5 | 5 | 1 | 0 |
| gideon-sato | member-gideon-sato | 2 | 2 | 2 | 2 | 2 | 1 | 0 |
| hollis-mbeki | member-hollis-mbeki | 3 | 3 | 3 | 3 | 3 | 1 | 0 |
| ilse-varga | member-ilse-varga | 5 | 5 | 5 | 5 | 5 | 1 | 0 |
| june-osei | member-june-osei | 3 | 3 | 3 | 3 | 3 | 1 | 0 |
| kwame-adjei | member-kwame-adjei | 2 | 2 | 2 | 2 | 2 | 1 | 0 |
| marcus-lindqvist | member-marcus-lindqvist | 5 | 5 | 5 | 5 | 5 | 1 | 0 |
| moss | member-moss | 2 | 2 | 2 | 2 | 2 | 1 | 0 |
| nadia-fennimore | member-nadia-fennimore | 2 | 2 | 2 | 2 | 2 | 1 | 0 |
| pree-sundaram | member-pree-sundaram | 3 | 3 | 3 | 3 | 3 | 1 | 0 |
| ruth-calloway | member-ruth-calloway | 2 | 2 | 2 | 2 | 2 | 1 | 0 |
| sofia-marchetti | member-sofia-marchetti | 2 | 2 | 2 | 2 | 2 | 1 | 0 |
| tobias-rendle | member-tobias-rendle | 3 | 3 | 3 | 3 | 3 | 1 | 0 |
| public-only | public-only | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Cells count the scripted facts whose marker came back (get_page and list_pages: whose page was served or listed).

Write carry (T8): anselm-grieve's put_page landed in private-anselm-grieve and remember landed in its write source.

| Reader | Write | Read tools that returned it |
|---|---|---|
| anselm-grieve | t8-page | search, query, recall, get_page, list_pages |
| anselm-grieve | t8-fact | search, query, recall, hot_memory |
| bettina-kroll | t8-page | none |
| bettina-kroll | t8-fact | none |
| dana-okafor | t8-page | none |
| dana-okafor | t8-fact | none |
| gideon-sato | t8-page | none |
| gideon-sato | t8-fact | none |
| hollis-mbeki | t8-page | none |
| hollis-mbeki | t8-fact | none |
| ilse-varga | t8-page | none |
| ilse-varga | t8-fact | none |
| june-osei | t8-page | none |
| june-osei | t8-fact | none |
| kwame-adjei | t8-page | none |
| kwame-adjei | t8-fact | none |
| marcus-lindqvist | t8-page | none |
| marcus-lindqvist | t8-fact | none |
| moss | t8-page | none |
| moss | t8-fact | none |
| nadia-fennimore | t8-page | none |
| nadia-fennimore | t8-fact | none |
| pree-sundaram | t8-page | none |
| pree-sundaram | t8-fact | none |
| ruth-calloway | t8-page | none |
| ruth-calloway | t8-fact | none |
| sofia-marchetti | t8-page | none |
| sofia-marchetti | t8-fact | none |
| tobias-rendle | t8-page | none |
| tobias-rendle | t8-fact | none |
| public-only | t8-page | none |
| public-only | t8-fact | none |

Informational `write_carry_member_only` (recorded, never a failure): put_page landed, crossed to bob:search, bob:query, bob:recall, bob:get_page, bob:list_pages, public:search, public:query, public:recall, public:get_page, public:list_pages; remember landed, crossed to nobody.

Informational `write_carry_attested_actor` (recorded, never a failure): may_act_for put_page landed, crossed to bob:search, bob:query, bob:recall, bob:get_page, bob:list_pages, public:search, public:query, public:recall, public:get_page, public:list_pages; attested_actor put_page landed, crossed to bob:search, bob:query, bob:recall, bob:get_page, bob:list_pages, public:search, public:query, public:recall, public:get_page, public:list_pages.
