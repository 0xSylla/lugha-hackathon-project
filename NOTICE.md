# Third-party notices

Lugha is MIT licensed (see [LICENSE](LICENSE)). It builds on the open-source projects below. Contract-side credits are in [contracts/NOTICE.md](contracts/NOTICE.md).

## Code taken or adapted

| Source | What | License |
|---|---|---|
| [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (PQA Labs) | `contracts/foundry.toml`, `contracts/src/mocks/MockUSD8.sol`, `contracts/test/Signing.sol`, the `IERC3009` interface and the deploy script pattern. Each file says so in its header. | MIT |

## JavaScript packages (direct dependencies)

| Package | Version | License |
|---|---|---|
| fflate | 0.8.3 | MIT |
| next | 15.5.29 | MIT |
| nostr-tools | 2.26.1 | Unlicense |
| pg | 8.23.1 | MIT |
| qrcode | 1.5.4 | MIT |
| react, react-dom | 19.3.1 | MIT |
| viem | 2.57.12 | MIT |
| ws | 8.23.0 | MIT |

Their own dependencies carry their own licenses (`npx license-checker --summary` lists them).
