// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KneeDeepAttestations} from "../src/KneeDeepAttestations.sol";
import {IReceiver} from "../src/IReceiver.sol";

/// Minimal Foundry cheatcodes (no forge-std dependency).
interface Vm {
  function prank(address sender, address origin) external;
  function prank(address sender) external;
  function warp(uint256 timestamp) external;
  function expectRevert(bytes calldata) external;
  function expectRevert() external;
}

contract KneeDeepAttestationsTest {
  Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
  address constant FORWARDER = address(0xF0);
  address constant SENDER = address(0x5E);
  uint64 constant NOW = 1_800_000_000;
  KneeDeepAttestations c;

  function setUp() public {
    vm.warp(NOW);
    c = new KneeDeepAttestations(FORWARDER, SENDER);
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

  /// A delivery as the simulation broadcast makes it: the forwarder calls, our sender signed the tx.
  function _deliver(bytes memory metadata, bytes memory report) internal {
    vm.prank(FORWARDER, SENDER);
    c.onReport(metadata, report);
  }

  function test_storesTheLatestAttestation() public {
    _deliver(_metadata(address(this)), _attestation(NOW - 60));
    KneeDeepAttestations.Attestation memory a = c.latest();
    require(a.asOf == NOW - 60 && a.arkivBlock == 300286 && a.reports == 46 && a.votes == 7, "header");
    require(a.areas.length == 2, "areas");
    require(keccak256(bytes(a.areas[0].cell)) == keccak256("te7uc8t") && a.areas[0].level == 2, "area 0");
    require(a.areas[0].confidenceBps == 9000 && a.areas[0].supporters == 4, "area 0 numbers");
    require(c.attestationCount() == 1, "count");
  }

  function test_replacesAreasOnTheNextAttestation() public {
    _deliver(_metadata(address(this)), _attestation(NOW - 600));
    KneeDeepAttestations.Area[] memory one = new KneeDeepAttestations.Area[](1);
    one[0] = KneeDeepAttestations.Area("te7u1e6", 4, 5000, 2, 2);
    _deliver(_metadata(address(this)), abi.encode(KneeDeepAttestations.Attestation(NOW, 1, bytes32(0), 2, 0, one)));
    require(c.latest().areas.length == 1 && c.latest().areas[0].level == 4, "replaced");
  }

  function test_rejectsAnyoneButTheForwarder() public {
    vm.expectRevert(abi.encodeWithSelector(KneeDeepAttestations.NotForwarder.selector, address(this)));
    c.onReport(_metadata(address(this)), _attestation(NOW));
  }

  function test_rejectsForgedDeliveriesThroughTheSimulationForwarder() public {
    // The simulation forwarder checks no signatures: a stranger's transaction must not get through.
    vm.expectRevert(abi.encodeWithSelector(KneeDeepAttestations.UntrustedSender.selector, address(0xBAD)));
    vm.prank(FORWARDER, address(0xBAD));
    c.onReport(_metadata(address(this)), _attestation(NOW));
  }

  function test_acceptsAnySenderOnceTrustIsInTheForwarder() public {
    c.setTrustedSender(address(0)); // production forwarder: the DON's signatures are verified there
    vm.prank(FORWARDER, address(0xD0));
    c.onReport(_metadata(address(this)), _attestation(NOW));
    require(c.attestationCount() == 1, "accepted");
  }

  function test_rejectsFutureDatedReports() public {
    // Would otherwise lock out every genuine report as "stale" until 2100.
    vm.expectRevert(abi.encodeWithSelector(KneeDeepAttestations.FutureReport.selector, uint64(4_102_444_800), NOW));
    _deliver(_metadata(address(this)), _attestation(4_102_444_800));
    // The cron's next scheduled time, a few minutes ahead, is fine.
    _deliver(_metadata(address(this)), _attestation(NOW + 5 minutes));
    require(c.attestationCount() == 1, "near-future accepted");
  }

  function test_rejectsStaleReports() public {
    _deliver(_metadata(address(this)), _attestation(NOW));
    vm.expectRevert(abi.encodeWithSelector(KneeDeepAttestations.StaleReport.selector, NOW, NOW));
    _deliver(_metadata(address(this)), _attestation(NOW));
  }

  function test_enforcesTheWorkflowOwnerWhenSet() public {
    c.setExpectedWorkflowOwner(address(0xBEEF));
    vm.expectRevert(abi.encodeWithSelector(KneeDeepAttestations.WrongWorkflowOwner.selector, address(this), address(0xBEEF)));
    _deliver(_metadata(address(this)), _attestation(NOW));
    _deliver(_metadata(address(0xBEEF)), _attestation(NOW));
    require(c.attestationCount() == 1, "accepted from the right owner");
  }

  function test_onlyOwnerConfigures() public {
    vm.prank(address(0xBAD));
    vm.expectRevert(abi.encodeWithSelector(KneeDeepAttestations.NotOwner.selector, address(0xBAD)));
    c.setForwarder(address(0x1));
    vm.prank(address(0xBAD));
    vm.expectRevert(abi.encodeWithSelector(KneeDeepAttestations.NotOwner.selector, address(0xBAD)));
    c.setTrustedSender(address(0xBAD));
  }

  function test_supportsTheReceiverInterface() public view {
    require(c.supportsInterface(type(IReceiver).interfaceId), "IReceiver");
  }
}
