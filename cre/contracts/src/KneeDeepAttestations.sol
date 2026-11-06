// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "./IERC165.sol";
import {IReceiver} from "./IReceiver.sol";

/// @title KneeDeepAttestations
/// @notice Independent attestations of KneeDeep's street-flooding answers, written by a Chainlink
///         CRE workflow (cre/kneedeep-verify). The DON reads KneeDeep's raw evidence from Arkiv's
///         public RPC, recomputes every ~150 m area with KneeDeep's published fusion engine, agrees
///         on the result, and delivers it here through the Chainlink Forwarder.
/// @dev Consensus proves the nodes agree on what the public evidence says, not that the human
///      reports are true. Only the configured Forwarder may write; stale reports are discarded.
contract KneeDeepAttestations is IReceiver {
  /// @notice One area's recomputed answer.
  struct Area {
    string cell; // geohash, precision 7 (~150 m)
    uint8 level; // 0 dry, 1 ankle, 2 knee, 3 waist, 4 closed; 255 contested
    uint16 confidenceBps; // confidence x 10_000
    uint16 supporters; // independent humans supporting the level
    uint16 reports; // reports considered (one per human)
  }

  /// @notice One run of the workflow. Encoded by cre/kneedeep-verify/attestation.ts.
  struct Attestation {
    uint64 asOf; // unix seconds the answer is computed for
    uint64 arkivBlock; // Arkiv block the evidence was read at
    bytes32 evidenceHash; // keccak256 of the sorted entity keys used
    uint32 reports;
    uint32 votes;
    Area[] areas;
  }

  address public owner;
  address public forwarder;
  /// @notice If set, only reports from workflows owned by this address are accepted.
  address public expectedWorkflowOwner;

  uint256 public attestationCount;
  Attestation private s_latest;

  event Attested(
    uint256 indexed index,
    uint64 asOf,
    uint64 arkivBlock,
    bytes32 evidenceHash,
    uint32 reports,
    uint32 votes,
    uint256 areas
  );
  event ForwarderUpdated(address previous, address current);
  event ExpectedWorkflowOwnerUpdated(address previous, address current);
  event OwnershipTransferred(address previous, address current);

  error NotForwarder(address sender);
  error NotOwner(address sender);
  error ZeroAddress();
  error StaleReport(uint64 asOf, uint64 latestAsOf);
  error WrongWorkflowOwner(address received, address expected);

  constructor(address forwarder_) {
    if (forwarder_ == address(0)) revert ZeroAddress();
    owner = msg.sender;
    forwarder = forwarder_;
    emit OwnershipTransferred(address(0), msg.sender);
    emit ForwarderUpdated(address(0), forwarder_);
  }

  modifier onlyOwner() {
    if (msg.sender != owner) revert NotOwner(msg.sender);
    _;
  }

  /// @inheritdoc IReceiver
  function onReport(bytes calldata metadata, bytes calldata report) external override {
    if (msg.sender != forwarder) revert NotForwarder(msg.sender);
    if (expectedWorkflowOwner != address(0)) {
      address workflowOwner = _workflowOwner(metadata);
      if (workflowOwner != expectedWorkflowOwner) revert WrongWorkflowOwner(workflowOwner, expectedWorkflowOwner);
    }

    Attestation memory a = abi.decode(report, (Attestation));
    // Receivers must discard stale reports: never let an older answer overwrite a newer one.
    if (attestationCount > 0 && a.asOf <= s_latest.asOf) revert StaleReport(a.asOf, s_latest.asOf);

    s_latest.asOf = a.asOf;
    s_latest.arkivBlock = a.arkivBlock;
    s_latest.evidenceHash = a.evidenceHash;
    s_latest.reports = a.reports;
    s_latest.votes = a.votes;
    delete s_latest.areas;
    for (uint256 i = 0; i < a.areas.length; i++) {
      s_latest.areas.push(a.areas[i]);
    }

    emit Attested(attestationCount, a.asOf, a.arkivBlock, a.evidenceHash, a.reports, a.votes, a.areas.length);
    attestationCount++;
  }

  /// @notice The most recent attestation, with every area.
  function latest() external view returns (Attestation memory) {
    return s_latest;
  }

  function setForwarder(address forwarder_) external onlyOwner {
    if (forwarder_ == address(0)) revert ZeroAddress();
    emit ForwarderUpdated(forwarder, forwarder_);
    forwarder = forwarder_;
  }

  /// @notice Pin the workflow owner (address(0) disables the check).
  function setExpectedWorkflowOwner(address workflowOwner) external onlyOwner {
    emit ExpectedWorkflowOwnerUpdated(expectedWorkflowOwner, workflowOwner);
    expectedWorkflowOwner = workflowOwner;
  }

  function transferOwnership(address newOwner) external onlyOwner {
    if (newOwner == address(0)) revert ZeroAddress();
    emit OwnershipTransferred(owner, newOwner);
    owner = newOwner;
  }

  /// @inheritdoc IERC165
  function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
    return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
  }

  /// @dev Forwarder metadata is abi.encodePacked(workflowId bytes32, workflowName bytes10, workflowOwner address).
  function _workflowOwner(bytes calldata metadata) private pure returns (address workflowOwner) {
    if (metadata.length < 62) return address(0);
    workflowOwner = address(bytes20(metadata[42:62]));
  }
}
