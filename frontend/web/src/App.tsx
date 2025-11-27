import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface NFTListing {
  id: string;
  name: string;
  encryptedPrice: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<NFTListing[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingListing, setCreatingListing] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newListingData, setNewListingData] = useState({ name: "", price: "", description: "" });
  const [selectedListing, setSelectedListing] = useState<NFTListing | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ visible: true, status: "error", message: "FHEVM initialization failed" });
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
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const businessIds = await contract.getAllBusinessIds();
      const listingsList: NFTListing[] = [];
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          listingsList.push({
            id: businessId,
            name: businessData.name,
            encryptedPrice: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      setListings(listingsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const createListing = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    setCreatingListing(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating NFT listing with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      const priceValue = parseInt(newListingData.price) || 0;
      const businessId = `nft-${Date.now()}`;
      const encryptedResult = await encrypt(contractAddress, address, priceValue);
      const tx = await contract.createBusinessData(
        businessId,
        newListingData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newListingData.description
      );
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      setTransactionStatus({ visible: true, status: "success", message: "Listing created!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      await loadData();
      setShowCreateModal(false);
      setNewListingData({ name: "", price: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingListing(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return Number(businessData.decryptedValue) || 0;
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
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadData();
      setTransactionStatus({ visible: true, status: "success", message: "Decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      return Number(clearValue);
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is verified" });
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
        setTransactionStatus({ visible: true, status: "success", message: "Service is available" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredListings = listings.filter(listing => 
    listing.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    listing.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>NFT Dark Pool 🔒</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        <div className="connection-prompt">
          <div className="connection-content">
            <h2>Connect Wallet to Access Private NFT Market</h2>
            <p>Your wallet connection enables FHE encryption for private NFT trading</p>
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
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted listings...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>NFT Dark Pool 🔒</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Private Listing
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="search-section">
          <input
            type="text"
            placeholder="Search NFT listings..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button onClick={checkAvailability} className="check-btn">
            Check Service
          </button>
        </div>

        <div className="stats-panel">
          <div className="stat-item">
            <h3>Total Listings</h3>
            <p>{listings.length}</p>
          </div>
          <div className="stat-item">
            <h3>Verified Prices</h3>
            <p>{listings.filter(l => l.isVerified).length}</p>
          </div>
          <div className="stat-item">
            <h3>FHE Protected</h3>
            <p>100%</p>
          </div>
        </div>

        <div className="listings-grid">
          {filteredListings.length === 0 ? (
            <div className="no-listings">
              <p>No private listings found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Listing
              </button>
            </div>
          ) : (
            filteredListings.map((listing, index) => (
              <div className="listing-card" key={index} onClick={() => setSelectedListing(listing)}>
                <div className="listing-header">
                  <h3>{listing.name}</h3>
                  <span className={`status ${listing.isVerified ? 'verified' : 'encrypted'}`}>
                    {listing.isVerified ? 'Verified' : 'Encrypted'}
                  </span>
                </div>
                <p className="description">{listing.description}</p>
                <div className="listing-footer">
                  <span>Creator: {listing.creator.substring(0, 6)}...{listing.creator.substring(38)}</span>
                  <button 
                    className="decrypt-btn"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const decrypted = await decryptData(listing.id);
                      if (decrypted !== null && selectedListing?.id === listing.id) {
                        setSelectedListing({...listing, decryptedValue: decrypted});
                      }
                    }}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? "Decrypting..." : "Decrypt Price"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New Private NFT Listing</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>NFT Name</label>
                <input 
                  type="text" 
                  value={newListingData.name} 
                  onChange={(e) => setNewListingData({...newListingData, name: e.target.value})} 
                  placeholder="Enter NFT name"
                />
              </div>
              <div className="form-group">
                <label>Price (ETH)</label>
                <input 
                  type="number" 
                  value={newListingData.price} 
                  onChange={(e) => setNewListingData({...newListingData, price: e.target.value})} 
                  placeholder="Enter price in ETH"
                  min="0"
                  step="0.01"
                />
                <span className="fhe-tag">FHE Encrypted</span>
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={newListingData.description} 
                  onChange={(e) => setNewListingData({...newListingData, description: e.target.value})} 
                  placeholder="Describe your NFT"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createListing} 
                disabled={creatingListing || isEncrypting || !newListingData.name || !newListingData.price}
                className="submit-btn"
              >
                {creatingListing || isEncrypting ? "Creating..." : "Create Private Listing"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedListing && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>NFT Listing Details</h2>
              <button onClick={() => setSelectedListing(null)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="detail-row">
                <span>Name:</span>
                <strong>{selectedListing.name}</strong>
              </div>
              <div className="detail-row">
                <span>Creator:</span>
                <strong>{selectedListing.creator.substring(0, 6)}...{selectedListing.creator.substring(38)}</strong>
              </div>
              <div className="detail-row">
                <span>Listed:</span>
                <strong>{new Date(selectedListing.timestamp * 1000).toLocaleDateString()}</strong>
              </div>
              <div className="detail-row">
                <span>Description:</span>
                <p>{selectedListing.description}</p>
              </div>
              <div className="detail-row">
                <span>Price:</span>
                <div className="price-display">
                  {selectedListing.isVerified ? (
                    <strong>{selectedListing.decryptedValue} ETH (Verified)</strong>
                  ) : selectedListing.decryptedValue ? (
                    <strong>{selectedListing.decryptedValue} ETH (Local)</strong>
                  ) : (
                    <strong>🔒 Encrypted</strong>
                  )}
                  <button 
                    className="verify-btn"
                    onClick={async () => {
                      const decrypted = await decryptData(selectedListing.id);
                      if (decrypted !== null) {
                        setSelectedListing({...selectedListing, decryptedValue: decrypted});
                      }
                    }}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? "Verifying..." : "Verify Price"}
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setSelectedListing(null)} className="close-btn">Close</button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className={`transaction-content ${transactionStatus.status}`}>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;