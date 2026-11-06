// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KneeDeepAttestations} from "../src/KneeDeepAttestations.sol";
import {IReceiver} from "../src/IReceiver.sol";

/// Minimal Foundry cheatcodes (no forge-std dependency).
interface Vm {
  function prank(address) external;
  function expectRevert(bytes calldata) external;
  function expectRevert() external;
}

contract KneeDeepAttestationsTest {
  Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
  address constant FORWARDER = address(0xF0);
  KneeDeepAttestations c;

  function setUp() public {
    c = new KneeDeepAttestations(FORWARDER);
  }

  function _attestation(uint64 asOf) internal pure returns (bytes memory) {
    KneeDeepAttestations.Area[] memory areas = new KneeDeepAttestations.Area[](2);
    areas[0] = KneeDeepAttestations.Area("te7uc8t", 2, 9000, 4, 4);
    areas[1] = KneeDeepAttestations.Area("te7u9zg", 0, 5200, 2, 2);
    return abi.encode(KneeDeepAttestations.Attestation(asOf, 300286, keccak256("evidence"), 46, 7, areas));
  }

  function _metadata(address workflowOwner) internal pure returns (bytes memory) {
    return abi.encodePacked(bytes32(uint256(1)), bytes10("kneedeep"), workflowOwner);
  }

  function test_storesTheLatestAttestation() public {
    vm.prank(FORWARDER);
    c.onReport(_metadata(address(this)), _attestation(1000));
    KneeDeepAttestations.Attestation memory a = c.latest();
    require(a.asOf == 1000 && a.arkivBlock == 300286 && a.reports == 46 && a.votes == 7, "header");
    require(a.areas.length == 2, "areas");
    require(keccak256(bytes(a.areas[0].cell)) == keccak256("te7uc8t") && a.areas[0].level == 2, "area 0");
    require(a.areas[0].confidenceBps == 9000 && a.areas[0].supporters == 4, "area 0 numbers");
    require(c.attestationCount() == 1, "count");
  }

  function test_replacesAreasOnTheNextAttestation() public {
    vm.prank(FORWARDER);
    c.onReport(_metadata(address(this)), _attestation(1000));
    KneeDeepAttestations.Area[] memory one = new KneeDeepAttestations.Area[](1);
    one[0] = KneeDeepAttestations.Area("te7u1e6", 4, 5000, 2, 2);
    vm.prank(FORWARDER);
    c.onReport(_metadata(address(this)), abi.encode(KneeDeepAttestations.Attestation(2000, 1, bytes32(0), 2, 0, one)));
    require(c.latest().areas.length == 1 && c.latest().areas[0].level == 4, "replaced");
  }

  function test_rejectsAnyoneButTheForwarder() public {
    vm.expectRevert(abi.encodeWithSelector(KneeDeepAttestations.NotForwarder.selector, address(this)));
    c.onReport(_metadata(address(this)), _attestation(1000));
  }

  function test_rejectsStaleReports() public {
    vm.prank(FORWARDER);
    c.onReport(_metadata(address(this)), _attestation(1000));
    vm.expectRevert(abi.encodeWithSelector(KneeDeepAttestations.StaleReport.selector, uint64(1000), uint64(1000)));
    vm.prank(FORWARDER);
    c.onReport(_metadata(address(this)), _attestation(1000));
  }

  function test_enforcesTheWorkflowOwnerWhenSet() public {
    c.setExpectedWorkflowOwner(address(0xBEEF));
    vm.expectRevert(abi.encodeWithSelector(KneeDeepAttestations.WrongWorkflowOwner.selector, address(this), address(0xBEEF)));
    vm.prank(FORWARDER);
    c.onReport(_metadata(address(this)), _attestation(1000));
    vm.prank(FORWARDER);
    c.onReport(_metadata(address(0xBEEF)), _attestation(1000));
    require(c.attestationCount() == 1, "accepted from the right owner");
  }

  function test_onlyOwnerConfigures() public {
    vm.prank(address(0xBAD));
    vm.expectRevert(abi.encodeWithSelector(KneeDeepAttestations.NotOwner.selector, address(0xBAD)));
    c.setForwarder(address(0x1));
  }

  function test_supportsTheReceiverInterface() public view {
    require(c.supportsInterface(type(IReceiver).interfaceId), "IReceiver");
  }
}
