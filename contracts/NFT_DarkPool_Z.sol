pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract NFTDarkPool is ZamaEthereumConfig {
    struct Order {
        address owner;
        euint32 encryptedPrice;
        uint256 tokenId;
        uint256 expiration;
        bool isBid;
        bool isActive;
    }

    struct Trade {
        uint256 bidId;
        uint256 askId;
        uint256 executionPrice;
        uint256 timestamp;
    }

    uint256 public nextOrderId;
    uint256 public nextTradeId;

    mapping(uint256 => Order) public orders;
    mapping(uint256 => Trade) public trades;
    mapping(address => uint256[]) public userOrders;

    event OrderPlaced(uint256 indexed orderId, address indexed owner, uint256 tokenId, bool isBid);
    event OrderCancelled(uint256 indexed orderId);
    event TradeExecuted(uint256 indexed tradeId, uint256 bidId, uint256 askId, uint256 executionPrice);

    constructor() ZamaEthereumConfig() {
        nextOrderId = 1;
        nextTradeId = 1;
    }

    function placeOrder(
        uint256 tokenId,
        externalEuint32 encryptedPrice,
        bytes calldata inputProof,
        bool isBid,
        uint256 expiration
    ) external {
        require(expiration > block.timestamp, "Order expired");
        require(FHE.isInitialized(FHE.fromExternal(encryptedPrice, inputProof)), "Invalid encrypted price");

        orders[nextOrderId] = Order({
            owner: msg.sender,
            encryptedPrice: FHE.fromExternal(encryptedPrice, inputProof),
            tokenId: tokenId,
            expiration: expiration,
            isBid: isBid,
            isActive: true
        });

        FHE.allowThis(orders[nextOrderId].encryptedPrice);
        FHE.makePubliclyDecryptable(orders[nextOrderId].encryptedPrice);

        userOrders[msg.sender].push(nextOrderId);

        emit OrderPlaced(nextOrderId, msg.sender, tokenId, isBid);
        nextOrderId++;
    }

    function cancelOrder(uint256 orderId) external {
        require(orderExists(orderId), "Order does not exist");
        require(orders[orderId].owner == msg.sender, "Not order owner");
        require(orders[orderId].isActive, "Order not active");

        orders[orderId].isActive = false;
        emit OrderCancelled(orderId);
    }

    function matchOrders(uint256 bidId, uint256 askId) external {
        require(orderExists(bidId) && orderExists(askId), "Order does not exist");
        require(orders[bidId].isActive && orders[askId].isActive, "Order not active");
        require(orders[bidId].isBid && !orders[askId].isBid, "Invalid order types");
        require(orders[bidId].tokenId == orders[askId].tokenId, "Token mismatch");
        require(orders[bidId].expiration > block.timestamp && orders[askId].expiration > block.timestamp, "Order expired");

        euint32 bidPrice = orders[bidId].encryptedPrice;
        euint32 askPrice = orders[askId].encryptedPrice;

        require(FHE.leq(bidPrice, askPrice), "Bid price below ask price");

        uint32 executionPrice = FHE.add(bidPrice, askPrice) / 2;

        trades[nextTradeId] = Trade({
            bidId: bidId,
            askId: askId,
            executionPrice: executionPrice,
            timestamp: block.timestamp
        });

        orders[bidId].isActive = false;
        orders[askId].isActive = false;

        emit TradeExecuted(nextTradeId, bidId, askId, executionPrice);
        nextTradeId++;
    }

    function getEncryptedPrice(uint256 orderId) external view returns (euint32) {
        require(orderExists(orderId), "Order does not exist");
        return orders[orderId].encryptedPrice;
    }

    function getUserOrders(address user) external view returns (uint256[] memory) {
        return userOrders[user];
    }

    function orderExists(uint256 orderId) internal view returns (bool) {
        return orderId > 0 && orderId < nextOrderId;
    }
}

