import React, { useState, useRef } from 'react';
import { X, Plus, Upload, FileUp, Download, Trash2, Settings, Globe, Zap, Wallet, Key, Save } from 'lucide-react';
import { Connection } from '@solana/web3.js';
import { WalletTooltip } from './Styles';
import { 
  createNewWallet,
  importWallet,
  fetchSolBalance,
  fetchTokenBalance,
  downloadAllWallets,
  WalletType,
  ConfigType,
  copyToClipboard
} from './Utils';
import { handleCleanupWallets } from './Manager';

interface EnhancedSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ConfigType;
  onConfigChange: (key: keyof ConfigType, value: string) => void;
  onSave: () => void;
  wallets: WalletType[];
  setWallets: (wallets: WalletType[]) => void;
  connection: Connection | null;
  solBalances: Map<string, number>;
  setSolBalances: (balances: Map<string, number>) => void;
  tokenBalances: Map<string, number>;
  setTokenBalances: (balances: Map<string, number>) => void;
  tokenAddress: string;
  showToast: (message: string, type: 'success' | 'error') => void;
  activeTab: 'network' | 'wallets' | 'advanced';
  setActiveTab: (tab: 'network' | 'wallets' | 'advanced') => void;
}

const EnhancedSettingsModal: React.FC<EnhancedSettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onConfigChange,
  onSave,
  wallets,
  setWallets,
  connection,
  solBalances,
  setSolBalances,
  tokenBalances,
  setTokenBalances,
  tokenAddress,
  showToast,
  activeTab,
  setActiveTab
}) => {
  const [isCreatingWallets, setIsCreatingWallets] = useState(false);
  const [walletQuantity, setWalletQuantity] = useState('1');
  const [importKey, setImportKey] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleCreateMultipleWallets = async () => {
    if (!connection) return;
    
    const quantity = parseInt(walletQuantity);
    if (isNaN(quantity) || quantity < 1 || quantity > 100) {
      showToast('Please enter a valid number between 1 and 100', 'error');
      return;
    }

    setIsCreatingWallets(true);
    
    try {
      const newWallets: WalletType[] = [];
      const newSolBalances = new Map(solBalances);
      const newTokenBalances = new Map(tokenBalances);
      
      for (let i = 0; i < quantity; i++) {
        const newWallet = await createNewWallet();
        newWallets.push(newWallet);
        
        // Fetch SOL balance for the new wallet
        const solBalance = await fetchSolBalance(connection, newWallet.address);
        newSolBalances.set(newWallet.address, solBalance);
        
        // Initialize token balance
        if (tokenAddress) {
          const tokenBalance = await fetchTokenBalance(connection, newWallet.address, tokenAddress);
          newTokenBalances.set(newWallet.address, tokenBalance);
        } else {
          newTokenBalances.set(newWallet.address, 0);
        }
        
        // Small delay between creations to ensure unique IDs
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      const updatedWallets = [...wallets, ...newWallets];
      setWallets(updatedWallets);
      setSolBalances(newSolBalances);
      setTokenBalances(newTokenBalances);
      
      showToast(`Successfully created ${quantity} wallet${quantity > 1 ? 's' : ''}`, 'success');
      setWalletQuantity('1');
    } catch (error) {
      console.error('Error creating wallets:', error);
      showToast('Failed to create wallets', 'error');
    } finally {
      setIsCreatingWallets(false);
    }
  };

  const handleImportWallet = async () => {
    if (!connection || !importKey.trim()) {
      setImportError('Please enter a private key');
      return;
    }
    
    try {
      const { wallet, error } = await importWallet(importKey.trim());
      
      if (error) {
        setImportError(error);
        return;
      }
      
      if (wallet) {
        // Check if wallet already exists
        const exists = wallets.some(w => w.address === wallet.address);
        if (exists) {
          setImportError('Wallet already exists');
          return;
        }
        
        const newWallets = [...wallets, wallet];
        setWallets(newWallets);
        
        // Fetch SOL balance for the imported wallet
        const solBalance = await fetchSolBalance(connection, wallet.address);
        const newSolBalances = new Map(solBalances);
        newSolBalances.set(wallet.address, solBalance);
        setSolBalances(newSolBalances);
        
        // Fetch token balance if token address is provided
        if (tokenAddress) {
          const tokenBalance = await fetchTokenBalance(connection, wallet.address, tokenAddress);
          const newTokenBalances = new Map(tokenBalances);
          newTokenBalances.set(wallet.address, tokenBalance);
          setTokenBalances(newTokenBalances);
        } else {
          const newTokenBalances = new Map(tokenBalances);
          newTokenBalances.set(wallet.address, 0);
          setTokenBalances(newTokenBalances);
        }
        
        setImportKey('');
        setImportError(null);
        showToast('Wallet imported successfully', 'success');
      } else {
        setImportError('Failed to import wallet');
      }
    } catch (error) {
      console.error('Error in handleImportWallet:', error);
      setImportError('Failed to import wallet');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !connection) return;

    setIsProcessingFile(true);
    setImportError(null);

    try {
      const text = await file.text();
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      
      // Base58 pattern for Solana private keys
      const base58Pattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
      
      let foundKeys: string[] = [];
      
      if (fileExtension === 'key') {
        // For .key files, treat the entire content as a single private key
        const trimmedText = text.trim();
        if (base58Pattern.test(trimmedText)) {
          foundKeys = [trimmedText];
        }
      } else {
        // For .txt files, process line by line
        const lines = text.split(/\r?\n/);
        foundKeys = lines
          .map(line => line.trim())
          .filter(line => base58Pattern.test(line));
      }

      if (foundKeys.length === 0) {
        setImportError('No valid private keys found in file');
        setIsProcessingFile(false);
        return;
      }

      const importedWallets: WalletType[] = [];
      const newSolBalances = new Map(solBalances);
      const newTokenBalances = new Map(tokenBalances);
      
      for (const key of foundKeys) {
        try {
          const { wallet, error } = await importWallet(key);
          
          if (error || !wallet) continue;
          
          // Check if wallet already exists
          const exists = wallets.some(w => w.address === wallet.address);
          if (exists) continue;
          
          importedWallets.push(wallet);
          
          // Fetch and store SOL balance
          const solBalance = await fetchSolBalance(connection, wallet.address);
          newSolBalances.set(wallet.address, solBalance);
          
          // Fetch and store token balance if token address is provided
          if (tokenAddress) {
            const tokenBalance = await fetchTokenBalance(connection, wallet.address, tokenAddress);
            newTokenBalances.set(wallet.address, tokenBalance);
          } else {
            newTokenBalances.set(wallet.address, 0);
          }
          
          // Add delay between imports
          await new Promise(resolve => setTimeout(resolve, 10));
        } catch (error) {
          console.error('Error importing wallet:', error);
        }
      }
      
      // Update balances maps
      setSolBalances(newSolBalances);
      setTokenBalances(newTokenBalances);
      
      if (importedWallets.length === 0) {
        setImportError('No new wallets could be imported');
      } else {
        const newWallets = [...wallets, ...importedWallets];
        setWallets(newWallets);
        showToast(`Successfully imported ${importedWallets.length} wallets`, 'success');
      }
    } catch (error) {
      console.error('Error processing file:', error);
      setImportError('Error processing file');
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSaveAndClose = () => {
    onSave();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#091217] border border-[#02b36d40] cyberpunk-border rounded-lg w-[90vw] max-w-4xl h-[85vh] p-6 mx-4 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-[#02b36d40]">
          <div className="flex items-center gap-3">
            <Settings className="text-[#02b36d]" size={24} />
            <h2 className="text-xl font-bold text-[#e4fbf2] font-mono tracking-wider">SYSTEM SETTINGS</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-[#ff224420] border border-[#ff224440] hover:border-[#ff2244] rounded transition-all duration-300"
            title="Close Settings"
          >
            <X size={20} className="text-[#ff2244]" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-6 bg-[#0a1419] rounded-lg p-1">
          {([
            { id: 'network', label: 'NETWORK', icon: Globe },
            { id: 'wallets', label: 'WALLETS', icon: Wallet },
            { id: 'advanced', label: 'ADVANCED', icon: Zap }
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-md transition-all duration-300 font-mono text-sm ${
                activeTab === id
                  ? 'bg-[#02b36d] text-black font-bold'
                  : 'text-[#7ddfbd] hover:text-[#e4fbf2] hover:bg-[#02b36d20]'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'network' && (
            <div className="space-y-6">
              <div className="bg-[#0a1419] border border-[#02b36d30] rounded-lg p-6">
                <h3 className="text-lg font-bold text-[#e4fbf2] font-mono mb-4 flex items-center gap-2">
                  <Globe size={20} className="text-[#02b36d]" />
                  NETWORK CONFIGURATION
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#7ddfbd] font-mono mb-2 uppercase tracking-wider">
                      RPC Endpoint
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={config.rpcEndpoint}
                        onChange={(e) => onConfigChange('rpcEndpoint', e.target.value)}
                        className="w-full bg-[#091217] border border-[#02b36d40] rounded p-3 text-sm text-[#e4fbf2] focus:border-[#02b36d] focus:outline-none cyberpunk-input font-mono"
                        placeholder="Enter RPC endpoint URL"
                      />
                      
                      {/* RPC Provider Indicator */}
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <div className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${
                            config.rpcEndpoint.includes('helius') ? 'bg-green-500' :
                            config.rpcEndpoint.includes('quiknode') ? 'bg-blue-500' :
                            config.rpcEndpoint.includes('api.mainnet-beta.solana.com') ? 'bg-yellow-500' :
                            'bg-gray-500'
                          }`}></div>
                          <span className="text-xs text-[#7ddfbd80] font-mono">
                            {config.rpcEndpoint.includes('helius') ? 'HELIUS' :
                             config.rpcEndpoint.includes('quiknode') ? 'QUICKNODE' :
                             config.rpcEndpoint.includes('api.mainnet-beta.solana.com') ? 'PUBLIC' :
                             'CUSTOM'}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* RPC Performance Notice */}
                    <div className="mt-3 p-3 bg-[#051014] border border-[#02b36d20] rounded-lg">
                      <div className="flex items-start gap-2">
                        <div className="w-2 h-2 bg-[#02b36d] rounded-full mt-2 flex-shrink-0"></div>
                        <div className="text-xs text-[#7ddfbd] font-mono leading-relaxed">
                          <span className="text-[#02b36d] font-semibold">PERFORMANCE TIP:</span> For best results and fastest balance updates, 
                          we recommend using <span className="text-[#e4fbf2] font-semibold">Helius RPC</span>. 
                          <br />
                          <span className="text-[#7ddfbd80]">Example: https://mainnet.helius-rpc.com/?api-key=YOUR_KEY</span>
                          <br />
                          <a 
                            href="https://www.helius.dev" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[#02b36d] hover:text-[#7ddfbd] underline transition-colors"
                          >
                            Get free Helius API key →
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm text-[#7ddfbd] font-mono mb-2 uppercase tracking-wider">
                      Transaction Fee (SOL)
                    </label>
                    <input
                      type="text"
                      value={config.transactionFee}
                      onChange={(e) => onConfigChange('transactionFee', e.target.value)}
                      className="w-full bg-[#091217] border border-[#02b36d40] rounded p-3 text-sm text-[#e4fbf2] focus:border-[#02b36d] focus:outline-none cyberpunk-input font-mono"
                      placeholder="0.000005"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'wallets' && (
            <div className="space-y-6">
              {/* Create Wallets Section */}
              <div className="bg-[#0a1419] border border-[#02b36d30] rounded-lg p-6">
                <h3 className="text-lg font-bold text-[#e4fbf2] font-mono mb-4 flex items-center gap-2">
                  <Plus size={20} className="text-[#02b36d]" />
                  CREATE WALLETS
                </h3>
                
                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <label className="block text-sm text-[#7ddfbd] font-mono mb-2 uppercase tracking-wider">
                      Quantity (1-100)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={walletQuantity}
                      onChange={(e) => setWalletQuantity(e.target.value)}
                      className="w-full bg-[#091217] border border-[#02b36d40] rounded p-3 text-sm text-[#e4fbf2] focus:border-[#02b36d] focus:outline-none cyberpunk-input font-mono"
                      placeholder="1"
                    />
                  </div>
                  <button
                    onClick={handleCreateMultipleWallets}
                    disabled={isCreatingWallets}
                    className={`px-6 py-3 ${
                      isCreatingWallets 
                        ? 'bg-[#02b36d50] cursor-not-allowed' 
                        : 'bg-[#02b36d] hover:bg-[#01a35f] cyberpunk-btn'
                    } text-black font-bold rounded font-mono tracking-wider transition-all duration-300`}
                  >
                    {isCreatingWallets ? 'CREATING...' : 'CREATE'}
                  </button>
                </div>
              </div>

              {/* Wallet Management Actions */}
              <div className="bg-[#0a1419] border border-[#02b36d30] rounded-lg p-6">
                <h3 className="text-lg font-bold text-[#e4fbf2] font-mono mb-4 flex items-center gap-2">
                  <Settings size={20} className="text-[#02b36d]" />
                  WALLET MANAGEMENT
                </h3>
                
                <div className="space-y-6">
                  {/* Import Section */}
                  <div className="space-y-4">
                    <h4 className="text-md font-bold text-[#e4fbf2] font-mono flex items-center gap-2">
                      <Key size={16} className="text-[#02b36d]" />
                      IMPORT WALLETS
                    </h4>
                    
                    {/* Single Import */}
                    <div className="space-y-3">
                      <input
                        type="text"
                        placeholder="Enter private key (base58)"
                        value={importKey}
                        onChange={(e) => {
                          setImportKey(e.target.value);
                          setImportError(null);
                        }}
                        className={`w-full bg-[#091217] border ${
                          importError ? 'border-[#ff2244]' : 'border-[#02b36d40]'
                        } rounded p-3 text-sm text-[#e4fbf2] focus:border-[#02b36d] focus:outline-none cyberpunk-input font-mono`}
                      />
                      {importError && (
                        <div className="text-[#ff2244] text-sm font-mono flex items-center">
                          <span className="mr-1">!</span> {importError}
                        </div>
                      )}
                      <button
                        onClick={handleImportWallet}
                        disabled={!importKey.trim()}
                        className={`w-full p-3 ${
                          !importKey.trim()
                            ? 'bg-[#02b36d20] cursor-not-allowed'
                            : 'bg-[#02b36d] hover:bg-[#01a35f] cyberpunk-btn'
                        } text-black font-bold rounded font-mono tracking-wider transition-all duration-300`}
                      >
                        IMPORT WALLET
                      </button>
                    </div>

                    {/* File Import */}
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt,.key"
                        onChange={handleFileUpload}
                        className="hidden"
                        disabled={isProcessingFile}
                        title="Import wallet file"
                        aria-label="Import wallet file"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessingFile}
                        className={`w-full p-3 ${
                          isProcessingFile 
                            ? 'bg-[#02b36d20] cursor-not-allowed' 
                            : 'bg-[#091217] hover:bg-[#02b36d20] cyberpunk-btn'
                        } border border-[#02b36d40] rounded font-mono text-sm transition-all duration-300 flex items-center justify-center gap-2`}
                      >
                        <FileUp size={16} />
                        {isProcessingFile ? 'PROCESSING FILE...' : 'IMPORT FROM FILE (.txt/.key)'}
                      </button>
                    </div>
                  </div>

                  {/* Management Actions */}
                  <div className="border-t border-[#02b36d20] pt-4">
                    <h4 className="text-md font-bold text-[#e4fbf2] font-mono mb-4">ACTIONS</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <button
                        onClick={() => downloadAllWallets(wallets)}
                        className="p-3 bg-[#091217] border border-[#02b36d40] hover:border-[#02b36d] rounded font-mono text-sm transition-all duration-300 flex items-center justify-center gap-2"
                      >
                        <Download size={16} />
                        EXPORT ALL WALLETS
                      </button>
                      
                      <button
                        onClick={() => handleCleanupWallets(wallets, solBalances, tokenBalances, setWallets, showToast)}
                        className="p-3 bg-[#091217] border border-[#ff224440] hover:border-[#ff2244] rounded font-mono text-sm transition-all duration-300 flex items-center justify-center gap-2 text-[#ff2244]"
                      >
                        <Trash2 size={16} />
                        REMOVE EMPTY WALLETS
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Wallet Stats */}
              <div className="bg-[#0a1419] border border-[#02b36d30] rounded-lg p-6">
                <h3 className="text-lg font-bold text-[#e4fbf2] font-mono mb-4">WALLET STATISTICS</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[#02b36d] font-mono">{wallets.length}</div>
                    <div className="text-sm text-[#7ddfbd] font-mono">TOTAL WALLETS</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[#02b36d] font-mono">
                      {Array.from(solBalances.values()).reduce((sum, balance) => sum + balance, 0).toFixed(4)}
                    </div>
                    <div className="text-sm text-[#7ddfbd] font-mono">TOTAL SOL</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[#02b36d] font-mono">
                      {Array.from(tokenBalances.values()).reduce((sum, balance) => sum + balance, 0).toLocaleString()}
                    </div>
                    <div className="text-sm text-[#7ddfbd] font-mono">TOTAL TOKENS</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[#02b36d] font-mono">
                      {wallets.filter(w => (solBalances.get(w.address) || 0) > 0).length}
                    </div>
                    <div className="text-sm text-[#7ddfbd] font-mono">ACTIVE WALLETS</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'advanced' && (
            <div className="space-y-6">
              <div className="bg-[#0a1419] border border-[#02b36d30] rounded-lg p-6">
                <h3 className="text-lg font-bold text-[#e4fbf2] font-mono mb-4 flex items-center gap-2">
                  <Zap size={20} className="text-[#02b36d]" />
                  ADVANCED SETTINGS
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-[#7ddfbd] font-mono mb-2 uppercase tracking-wider">
                      API Key (Optional)
                    </label>
                    <input
                      type="password"
                      value={config.apiKey}
                      onChange={(e) => onConfigChange('apiKey', e.target.value)}
                      className="w-full bg-[#091217] border border-[#02b36d40] rounded p-3 text-sm text-[#e4fbf2] focus:border-[#02b36d] focus:outline-none cyberpunk-input font-mono"
                      placeholder="Enter API key for enhanced features"
                    />
                  </div>
                  
                  <div className="bg-[#091217] border border-[#02b36d20] rounded p-4">
                    <h4 className="text-sm font-bold text-[#e4fbf2] font-mono mb-2">SYSTEM INFORMATION</h4>
                    <div className="space-y-2 text-sm font-mono">
                      <div className="flex justify-between">
                        <span className="text-[#7ddfbd]">Connection Status:</span>
                        <span className={connection ? 'text-[#02b36d]' : 'text-[#ff2244]'}>
                          {connection ? 'CONNECTED' : 'DISCONNECTED'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#7ddfbd]">RPC Endpoint:</span>
                        <span className="text-[#e4fbf2] truncate ml-2" title={config.rpcEndpoint}>
                          {config.rpcEndpoint.length > 30 ? config.rpcEndpoint.substring(0, 30) + '...' : config.rpcEndpoint}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[#02b36d40]">
          <button
            onClick={onClose}
            className="px-6 py-3 bg-[#091217] border border-[#02b36d40] hover:border-[#02b36d] rounded font-mono text-sm transition-all duration-300"
          >
            CANCEL
          </button>
          <button
            onClick={handleSaveAndClose}
            className="px-6 py-3 bg-[#02b36d] hover:bg-[#01a35f] text-black font-bold rounded cyberpunk-btn font-mono tracking-wider transition-all duration-300 flex items-center gap-2"
          >
            <Save size={16} />
            SAVE SETTINGS
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnhancedSettingsModal;