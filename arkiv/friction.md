# Arkiv friction log

Kept as we build, with the time of each entry. Feeds the Arkiv submission.

| When (IST) | What happened                                                                                                            | Impact                                           | Workaround                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| Nov 6      | The public Rabdi RPC is heavily rate limited; an access key from hub.arkiv.network is needed for anything beyond a demo. | Setup step not obvious from the quickstart alone | Added `ARKIV_ACCESS_KEY` to `.env.example`      |
| Nov 6      | An expiry must be a whole number of blocks' worth of seconds, otherwise `InvalidExpiryError`.                            | A demo TTL like 100 s might fail                 | Use minute multiples (`REPORT_TTL_SECONDS=120`) |
