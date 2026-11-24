// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Adapted from qday-io/aevum-starter-kit (MIT, PQA Labs), contracts/script/Deploy.s.sol.

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TaskEscrow} from "../src/TaskEscrow.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";

/// @notice Deploys TaskEscrow.
///   - Aevum testnet (44005) and a local fork of it: uses the real tUSD8.
///   - anvil (31337) only: deploys MockUSD8 first and mints 1,000 to the deployer.
///   - Anywhere else it stops, rather than deploy a token anyone can mint.
///
///   forge script script/Deploy.s.sol --rpc-url aevum --account <keystore> --broadcast
contract Deploy is Script {
    address constant AEVUM_TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;
    uint256 constant ANVIL_CHAIN = 31337;

    function run() external returns (TaskEscrow escrow, address token) {
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        if (AEVUM_TUSD8.code.length > 0) {
            token = AEVUM_TUSD8;
        } else {
            require(block.chainid == ANVIL_CHAIN, "tUSD8 not found on this chain. Check the RPC (Aevum testnet is 44005).");
            MockUSD8 mock = new MockUSD8();
            mock.mint(deployer, 1_000e6);
            token = address(mock);
        }
        escrow = new TaskEscrow(IERC20(token));
        vm.stopBroadcast();

        console.log("chainId    ", block.chainid);
        console.log("token      ", token);
        console.log("TaskEscrow ", address(escrow));
    }
}
