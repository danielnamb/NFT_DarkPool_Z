import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface NFTOrder {
  id: string;
  name: string;
  tokenId: number;
  orderType: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface MarketStats {
  totalOrders: number;
  verifiedOrders: number;
  avgPrice: number;
  recentActivity: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<NFTOrder[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newOrderData, setNewOrderData] = useState({ name: "", price: "", tokenId: "", orderType: "0", description: "" });
  const [selectedOrder, setSelectedOrder] = useState<NFTOrder | null>(null);
  const [decryptedPrice, setDecryptedPrice] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [marketStats, setMarketStats] = useState<MarketStats>({ totalOrders: 0, verifiedOrders: 0, avgPrice: 0, recentActivity: 0 });
  const [userHistory, setUserHistory] = useState<NFTOrder[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const ordersList: NFTOrder[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          ordersList.push({
            id: businessId,
            name: businessData.name,
            tokenId: Number(businessData.publicValue1),
            orderType: Number(businessData.publicValue2),
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading order data:', e);
        }
      }
      
      setOrders(ordersList);
      calculateMarketStats(ordersList);
      filterUserHistory(ordersList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateMarketStats = (ordersList: NFTOrder[]) => {
    const totalOrders = ordersList.length;
    const verifiedOrders = ordersList.filter(o => o.isVerified).length;
    const avgPrice = ordersList.length > 0 
      ? ordersList.reduce((sum, o) => sum + (o.isVerified ? (o.decryptedValue || 0) : 0), 0) / ordersList.length 
      : 0;
    const recentActivity = ordersList.filter(o => 
      Date.now()/1000 - o.timestamp < 60 * 60 * 24
    ).length;

    setMarketStats({ totalOrders, verifiedOrders, avgPrice, recentActivity });
  };

  const filterUserHistory = (ordersList: NFTOrder[]) => {
    if (!address) return;
    const userOrders = ordersList.filter(order => order.creator.toLowerCase() === address.toLowerCase());
    setUserHistory(userOrders);
  };

  const createOrder = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingOrder(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating order with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const priceValue = parseInt(newOrderData.price) || 0;
      const businessId = `order-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, priceValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newOrderData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newOrderData.tokenId) || 0,
        parseInt(newOrderData.orderType) || 0,
        newOrderData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Confirming transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Order created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewOrderData({ name: "", price: "", tokenId: "", orderType: "0", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingOrder(false); 
    }
  };

  const decryptPrice = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) return null;
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Price verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Price decrypted!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Price verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract available" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>NFT Dark Pool</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Wallet to Access</h2>
            <p>Private NFT trading with FHE encryption</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to start</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initialization</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Trade NFTs privately</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
        <p className="loading-note">Securing your transactions</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading dark pool...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>NFT Dark Pool</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Order
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>NFT Dark Pool Analytics</h2>
          
          <div className="dashboard-panels">
            <div className="panel metal-panel">
              <h3>Total Orders</h3>
              <div className="stat-value">{marketStats.totalOrders}</div>
              <div className="stat-trend">+{marketStats.recentActivity} today</div>
            </div>
            
            <div className="panel metal-panel">
              <h3>Verified Prices</h3>
              <div className="stat-value">{marketStats.verifiedOrders}</div>
              <div className="stat-trend">FHE Verified</div>
            </div>
            
            <div className="panel metal-panel">
              <h3>Avg Price</h3>
              <div className="stat-value">{marketStats.avgPrice.toFixed(2)} ETH</div>
              <div className="stat-trend">FHE Protected</div>
            </div>
          </div>
          
          <div className="panel metal-panel full-width">
            <h3>FHE Encryption Flow</h3>
            <div className="fhe-flow">
              <div className="flow-step">
                <div className="step-icon">1</div>
                <div className="step-content">
                  <h4>Price Encryption</h4>
                  <p>Bid/ask prices encrypted with FHE</p>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">2</div>
                <div className="step-content">
                  <h4>On-chain Matching</h4>
                  <p>Private matching without revealing prices</p>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">3</div>
                <div className="step-content">
                  <h4>Secure Settlement</h4>
                  <p>Only matched parties see final price</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="orders-section">
          <div className="section-header">
            <h2>Active Orders</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button 
                onClick={checkAvailability}
                className="check-btn"
              >
                Check Contract
              </button>
            </div>
          </div>
          
          <div className="orders-list">
            {orders.length === 0 ? (
              <div className="no-orders">
                <p>No orders found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Order
                </button>
              </div>
            ) : orders.map((order, index) => (
              <div 
                className={`order-item ${selectedOrder?.id === order.id ? "selected" : ""} ${order.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedOrder(order)}
              >
                <div className="order-title">{order.name}</div>
                <div className="order-meta">
                  <span>Token ID: {order.tokenId}</span>
                  <span>Type: {order.orderType === 0 ? "Buy" : "Sell"}</span>
                </div>
                <div className="order-status">
                  {order.isVerified ? "✅ Verified Price" : "🔒 Encrypted Price"}
                </div>
                <div className="order-creator">Creator: {order.creator.substring(0, 6)}...{order.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="user-section">
          <h2>Your Trading History</h2>
          <div className="history-list">
            {userHistory.length === 0 ? (
              <div className="no-history">
                <p>No trading history</p>
              </div>
            ) : userHistory.map((order, index) => (
              <div className="history-item" key={index}>
                <div className="history-title">{order.name}</div>
                <div className="history-meta">
                  <span>{new Date(order.timestamp * 1000).toLocaleDateString()}</span>
                  <span>{order.orderType === 0 ? "Buy" : "Sell"}</span>
                </div>
                <div className="history-status">
                  {order.isVerified ? `Price: ${order.decryptedValue} ETH` : "Price encrypted"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateOrder 
          onSubmit={createOrder} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingOrder} 
          orderData={newOrderData} 
          setOrderData={setNewOrderData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedOrder && (
        <OrderDetailModal 
          order={selectedOrder} 
          onClose={() => { 
            setSelectedOrder(null); 
            setDecryptedPrice(null); 
          }} 
          decryptedPrice={decryptedPrice} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptPrice={() => decryptPrice(selectedOrder.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateOrder: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  orderData: any;
  setOrderData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, orderData, setOrderData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'price' || name === 'tokenId') {
      const intValue = value.replace(/[^\d]/g, '');
      setOrderData({ ...orderData, [name]: intValue });
    } else {
      setOrderData({ ...orderData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-order-modal">
        <div className="modal-header">
          <h2>New NFT Order</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Encryption</strong>
            <p>Price will be encrypted with FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>NFT Name *</label>
            <input 
              type="text" 
              name="name" 
              value={orderData.name} 
              onChange={handleChange} 
              placeholder="Enter NFT name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Price (ETH) *</label>
            <input 
              type="number" 
              name="price" 
              value={orderData.price} 
              onChange={handleChange} 
              placeholder="Enter price..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted</div>
          </div>
          
          <div className="form-group">
            <label>Token ID *</label>
            <input 
              type="number" 
              name="tokenId" 
              value={orderData.tokenId} 
              onChange={handleChange} 
              placeholder="Enter token ID..." 
              min="0"
            />
            <div className="data-type-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Order Type *</label>
            <select 
              name="orderType" 
              value={orderData.orderType} 
              onChange={handleChange}
            >
              <option value="0">Buy Order</option>
              <option value="1">Sell Order</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={orderData.description} 
              onChange={handleChange} 
              placeholder="Enter description..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !orderData.name || !orderData.price || !orderData.tokenId} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Order"}
          </button>
        </div>
      </div>
    </div>
  );
};

const OrderDetailModal: React.FC<{
  order: NFTOrder;
  onClose: () => void;
  decryptedPrice: number | null;
  isDecrypting: boolean;
  decryptPrice: () => Promise<number | null>;
}> = ({ order, onClose, decryptedPrice, isDecrypting, decryptPrice }) => {
  const handleDecrypt = async () => {
    if (decryptedPrice !== null) return;
    
    const price = await decryptPrice();
    if (price !== null) {
      setDecryptedPrice(price);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="order-detail-modal">
        <div className="modal-header">
          <h2>Order Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="order-info">
            <div className="info-item">
              <span>NFT Name:</span>
              <strong>{order.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{order.creator.substring(0, 6)}...{order.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(order.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Token ID:</span>
              <strong>{order.tokenId}</strong>
            </div>
            <div className="info-item">
              <span>Order Type:</span>
              <strong>{order.orderType === 0 ? "Buy" : "Sell"}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Price</h3>
            
            <div className="data-row">
              <div className="data-label">Price:</div>
              <div className="data-value">
                {order.isVerified ? 
                  `${order.decryptedValue} ETH (Verified)` : 
                  decryptedPrice !== null ? 
                  `${decryptedPrice} ETH (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              {!order.isVerified && (
                <button 
                  className={`decrypt-btn ${decryptedPrice !== null ? 'decrypted' : ''}`}
                  onClick={handleDecrypt} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : "Reveal Price"}
                </button>
              )}
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Price</strong>
                <p>Price remains encrypted until order matching</p>
              </div>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{order.description || "No description provided"}</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

