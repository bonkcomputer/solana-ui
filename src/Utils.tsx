import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import Cookies from 'js-cookie';
import CryptoJS from 'crypto-js';

export interface WalletType {
  id: number;
  address: string;
  privateKey: string;
  isActive: boolean;
  tokenBalance?: number;
  label?: string;
}

export interface ConfigType {
  rpcEndpoint: string;
  transactionFee: string;
  apiKey: string;
  selectedDex: string;
  isDropdownOpen: boolean;
  buyAmount: string;
  sellAmount: string;
}

export const toggleWallet = (wallets: WalletType[], id: number): WalletType[] => {
  return wallets.map(wallet => 
    wallet.id === id ? { ...wallet, isActive: !wallet.isActive } : wallet
  );
};

export const deleteWallet = (wallets: WalletType[], id: number): WalletType[] => {
  return wallets.filter(wallet => wallet.id !== id);
};

// Database setup
const DB_NAME = 'WalletDB';
const DB_VERSION = 1;
const WALLET_STORE = 'wallets';

// Initialize database immediately
let db: IDBDatabase | null = null;
const request = indexedDB.open(DB_NAME, DB_VERSION);

request.onerror = () => {
  console.error('Error opening database:', request.error);
};

request.onsuccess = (event: Event) => {
  db = request.result;
};

request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
  db = request.result;
  if (!db.objectStoreNames.contains(WALLET_STORE)) {
    // Create object store for encrypted wallet data
    db.createObjectStore(WALLET_STORE, { keyPath: 'id' });
  }
};

// Function to load wallets from IndexedDB with encryption support
const loadWalletsFromIndexedDB = (): Promise<WalletType[]> => {
  return new Promise((resolve) => {
    if (!db) {
      resolve([]);
      return;
    }

    try {
      const transaction = db.transaction(WALLET_STORE, 'readonly');
      const store = transaction.objectStore(WALLET_STORE);
      const request = store.get('encrypted_wallets');

      request.onsuccess = () => {
        try {
          if (request.result && request.result.data) {
            const decryptedData = decryptData(request.result.data);
            const wallets = JSON.parse(decryptedData);
            resolve(wallets);
          } else {
            resolve([]);
          }
        } catch (error) {
          console.error('Error decrypting IndexedDB data:', error);
          resolve([]);
        }
      };

      request.onerror = () => {
        console.error('Error loading from IndexedDB:', request.error);
        resolve([]);
      };
    } catch (error) {
      console.error('Error accessing IndexedDB:', error);
      resolve([]);
    }
  });
};
const WALLET_COOKIE_KEY = 'wallets';
const CONFIG_COOKIE_KEY = 'config';
const QUICK_BUY_COOKIE_KEY = 'quickBuyPreferences';

// Encryption setup
const ENCRYPTION_KEY = 'raze-bot-wallet-encryption-key';
const ENCRYPTED_STORAGE_KEY = 'encrypted_wallets';

// Encryption helper functions
const encryptData = (data: string): string => {
  try {
    return CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString();
  } catch (error) {
    console.error('Error encrypting data:', error);
    throw new Error('Failed to encrypt data');
  }
};

const decryptData = (encryptedData: string): string => {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
    const decryptedData = bytes.toString(CryptoJS.enc.Utf8);
    if (!decryptedData) {
      throw new Error('Failed to decrypt data - invalid key or corrupted data');
    }
    return decryptedData;
  } catch (error) {
    console.error('Error decrypting data:', error);
    throw new Error('Failed to decrypt data');
  }
};

// Export encryption utilities for potential external use
export const encryptWalletData = (data: string): string => {
  return encryptData(data);
};

export const decryptWalletData = (encryptedData: string): string => {
  return decryptData(encryptedData);
};

// Function to check if wallet data is encrypted
export const isWalletDataEncrypted = (): boolean => {
  const encryptedData = localStorage.getItem(ENCRYPTED_STORAGE_KEY);
  const unencryptedData = localStorage.getItem('wallets');
  return !!encryptedData && !unencryptedData;
};

// Function to migrate unencrypted data to encrypted storage
export const migrateToEncryptedStorage = (): boolean => {
  try {
    const unencryptedData = localStorage.getItem('wallets');
    if (unencryptedData) {
      const wallets = JSON.parse(unencryptedData);
      saveWalletsToCookies(wallets);
      console.log('Successfully migrated wallet data to encrypted storage');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error migrating to encrypted storage:', error);
    return false;
  }
};

export const createNewWallet = async (): Promise<WalletType> => {
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toString();
  const privateKey = bs58.encode(keypair.secretKey);
  
  return {
    id: Date.now(),
    address,
    privateKey,
    isActive: false
  };
};

export const importWallet = async (
  privateKeyString: string
): Promise<{ wallet: WalletType | null; error?: string }> => {
  try {
    // Basic validation
    if (!privateKeyString.trim()) {
      return { wallet: null, error: 'Private key cannot be empty' };
    }

    // Try to decode the private key
    let privateKeyBytes;
    try {
      privateKeyBytes = bs58.decode(privateKeyString);
      
      // Validate key length (Solana private keys are 64 bytes)
      if (privateKeyBytes.length !== 64) {
        return { wallet: null, error: 'Invalid private key length' };
      }
    } catch (e) {
      return { wallet: null, error: 'Invalid private key format' };
    }

    // Create keypair and get address
    const keypair = Keypair.fromSecretKey(privateKeyBytes);
    const address = keypair.publicKey.toString();
    
    const wallet: WalletType = {
      id: Date.now(),
      address,
      privateKey: privateKeyString,
      isActive: false
    };
    
    return { wallet };
  } catch (error) {
    console.error('Error importing wallet:', error);
    return { wallet: null, error: 'Failed to import wallet' };
  }
};

export const formatAddress = (address: string) => {
  if (address.length < 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

export const getWalletDisplayName = (wallet: WalletType): string => {
  return wallet.label && wallet.label.trim() ? wallet.label : formatAddress(wallet.address);
};

export const copyToClipboard = async (text: string, showToast: (message: string, type: 'success' | 'error') => void): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied successfully", "success")

    return true;
  } catch (error) {
    console.error('Failed to copy:', error);
    return false;
  }
};
export const getActiveWalletPrivateKeys = (): string => {
  try {
    const activeWallets = getActiveWallets()
    return activeWallets
      .map(wallet => wallet.privateKey)
      .join(',');
  } catch (error) {
    console.error('Error getting private keys:', error);
    return '';
  }
};
export const getWallets = (): WalletType[] => {
  try {
    // Use the encrypted loading function
    return loadWalletsFromCookies();
  } catch (error) {
    console.error('Error loading wallets:', error);
    return [];
  }
};
export const getActiveWallets = (): WalletType[] => {
  try {
    const savedWallets = Cookies.get(WALLET_COOKIE_KEY);
    if (!savedWallets) return [];
    const parsedWallets = JSON.parse(savedWallets);
    return parsedWallets.filter((wallet: WalletType) => wallet.isActive);
  } catch (error) {
    console.error('Error loading active wallets from cookies:', error);
    return [];
  }
};
export const fetchTokenBalance = async (
  connection: Connection,
  walletAddress: string,
  tokenMint: string
): Promise<number> => {
  try {
    const walletPublicKey = new PublicKey(walletAddress);
    const tokenMintPublicKey = new PublicKey(tokenMint);

    // Find token account with more reliable commitment level
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletPublicKey,
      {
        mint: tokenMintPublicKey
      }, 
      "confirmed" // Use confirmed instead of processed for more reliability
    );

    // If no token account found, return 0
    if (tokenAccounts.value.length === 0) return 0;

    // Get balance from the first token account
    const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    return balance || 0;
  } catch (error) {
    console.error('Error fetching token balance:', error);
    return 0;
  }
};

export const fetchTokenBalanceWithRetry = async (
  connection: Connection,
  walletAddress: string,
  tokenMint: string,
  maxRetries: number = 3
): Promise<number> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const balance = await fetchTokenBalance(connection, walletAddress, tokenMint);
      return balance;
    } catch (error) {
      console.warn(`Token balance fetch attempt ${attempt}/${maxRetries} failed for ${walletAddress}:`, error);
      
      if (attempt === maxRetries) {
        console.error(`All ${maxRetries} attempts failed for token balance ${walletAddress}`);
        return 0;
      }
      
      // Exponential backoff: wait longer between retries
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return 0;
};

export const fetchSolBalance = async (
  connection: Connection,
  walletAddress: string
): Promise<number> => {
  try {
    const publicKey = new PublicKey(walletAddress);
    const balance = await connection.getBalance(publicKey, "confirmed"); // Use confirmed for more reliability
    return balance / 1e9;
  } catch (error) {
    console.error('Error fetching SOL balance:', error);
    return 0;
  }
};

export const fetchSolBalanceWithRetry = async (
  connection: Connection,
  walletAddress: string,
  maxRetries: number = 3
): Promise<number> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const balance = await fetchSolBalance(connection, walletAddress);
      return balance;
    } catch (error) {
      console.warn(`SOL balance fetch attempt ${attempt}/${maxRetries} failed for ${walletAddress}:`, error);
      
      if (attempt === maxRetries) {
        console.error(`All ${maxRetries} attempts failed for SOL balance ${walletAddress}`);
        return 0;
      }
      
      // Exponential backoff: wait longer between retries
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return 0;
};

export const refreshWalletBalance = async (
  wallet: WalletType,
  connection: Connection,
  tokenAddress?: string
): Promise<WalletType> => {
  try {
    if (!tokenAddress) return wallet;
    
    const tokenBalance = await fetchTokenBalance(connection, wallet.address, tokenAddress);
    
    return {
      ...wallet,
      tokenBalance: tokenBalance
    };
  } catch (error) {
    console.error('Error refreshing wallet balance:', error);
    return wallet;
  }
};

/**
 * Create a more reliable RPC connection with fallback endpoints
 * Supports any RPC endpoint including Helius, QuickNode, and public endpoints
 */
export const createReliableConnection = (primaryEndpoint: string): Connection => {
  // Fallback RPC endpoints for better reliability
  const fallbackEndpoints = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana',
    'https://solana-mainnet.rpc.extrnode.com'
  ];
  
  // Validate and clean the endpoint URL
  const cleanEndpoint = primaryEndpoint?.trim();
  if (!cleanEndpoint || !cleanEndpoint.startsWith('http')) {
    console.warn('Invalid RPC endpoint provided, using fallback');
    return createConnectionWithFallback(fallbackEndpoints);
  }
  
  try {
    // Configure connection options based on endpoint type
    const connectionOptions = getConnectionOptions(cleanEndpoint);
    
    // Try primary endpoint first
    const connection = new Connection(cleanEndpoint, connectionOptions);
    console.log(`Connected to RPC: ${cleanEndpoint}`);
    return connection;
  } catch (error) {
    console.warn('Primary RPC endpoint failed, trying fallback:', error);
    return createConnectionWithFallback(fallbackEndpoints);
  }
};

/**
 * Get optimal connection options based on RPC provider
 */
const getConnectionOptions = (endpoint: string) => {
  const baseOptions = {
    commitment: 'confirmed' as const,
    confirmTransactionInitialTimeout: 60000,
    disableRetryOnRateLimit: false
  };

  // Helius RPC optimizations
  if (endpoint.includes('helius')) {
    return {
      ...baseOptions,
      confirmTransactionInitialTimeout: 30000, // Helius is faster
      disableRetryOnRateLimit: true // Helius handles retries internally
    };
  }
  
  // QuickNode optimizations
  if (endpoint.includes('quiknode')) {
    return {
      ...baseOptions,
      confirmTransactionInitialTimeout: 45000,
      disableRetryOnRateLimit: false
    };
  }
  
  // Public RPC endpoints (more conservative)
  if (endpoint.includes('api.mainnet-beta.solana.com') || 
      endpoint.includes('solana-api.projectserum.com')) {
    return {
      ...baseOptions,
      confirmTransactionInitialTimeout: 90000, // Public RPCs can be slower
      disableRetryOnRateLimit: true
    };
  }
  
  return baseOptions;
};

/**
 * Create connection with fallback endpoints
 */
const createConnectionWithFallback = (fallbackEndpoints: string[]): Connection => {
  for (const endpoint of fallbackEndpoints) {
    try {
      const options = getConnectionOptions(endpoint);
      const connection = new Connection(endpoint, options);
      console.log(`Connected to fallback RPC: ${endpoint}`);
      return connection;
    } catch (fallbackError) {
      console.warn(`Fallback RPC ${endpoint} failed:`, fallbackError);
    }
  }
  
  // Last resort - use the first fallback endpoint without options
  console.warn('All RPC endpoints failed, using basic connection');
  return new Connection(fallbackEndpoints[0]);
};


export const saveWalletsToCookies = (wallets: WalletType[]): void => {
  try {
    // Encrypt wallet data before storing
    const walletData = JSON.stringify(wallets);
    const encryptedData = encryptData(walletData);
    console.log('🔐 Wallet data encrypted and saved successfully');
    
    if (!db) {
      // Fallback to localStorage if DB is not ready
      localStorage.setItem(ENCRYPTED_STORAGE_KEY, encryptedData);
      // Remove old unencrypted data
      localStorage.removeItem('wallets');
      return;
    }

    const transaction = db.transaction(WALLET_STORE, 'readwrite');
    const store = transaction.objectStore(WALLET_STORE);
    
    store.clear();
    // Store encrypted wallet data in IndexedDB
    const encryptedWallet = {
      id: 'encrypted_wallets',
      data: encryptedData
    };
    store.add(encryptedWallet);
    
    // Also save encrypted data to localStorage as backup
    localStorage.setItem(ENCRYPTED_STORAGE_KEY, encryptedData);
    // Remove old unencrypted data
    localStorage.removeItem('wallets');
  } catch (error) {
    console.error('Error saving encrypted wallets:', error);
    // Fallback to localStorage with encryption
    try {
      const walletData = JSON.stringify(wallets);
      const encryptedData = encryptData(walletData);
      localStorage.setItem(ENCRYPTED_STORAGE_KEY, encryptedData);
      localStorage.removeItem('wallets');
    } catch (encryptError) {
      console.error('Error with encryption fallback:', encryptError);
      // Last resort: save unencrypted (should rarely happen)
      localStorage.setItem('wallets', JSON.stringify(wallets));
    }
  }
};

export const loadWalletsFromCookies = (): WalletType[] => {
  try {
    // First try to get encrypted data from localStorage
    const encryptedData = localStorage.getItem(ENCRYPTED_STORAGE_KEY);
    if (encryptedData) {
      try {
        const decryptedData = decryptData(encryptedData);
        const parsedWallets = JSON.parse(decryptedData);
        return parsedWallets;
      } catch (decryptError) {
        console.error('Error decrypting wallet data:', decryptError);
        // If decryption fails, try to load old unencrypted data as fallback
        const oldWallets = localStorage.getItem('wallets');
        if (oldWallets) {
          console.log('🔄 Loading from old unencrypted storage and migrating...');
          const parsedWallets = JSON.parse(oldWallets);
          // Migrate to encrypted storage
          saveWalletsToCookies(parsedWallets);
          return parsedWallets;
        }
      }
    }
    
    // Fallback to old unencrypted data if no encrypted data exists
    const oldWallets = localStorage.getItem('wallets');
    if (oldWallets) {
      console.log('🔄 Migrating from unencrypted to encrypted storage...');
      const parsedWallets = JSON.parse(oldWallets);
      // Migrate to encrypted storage
      saveWalletsToCookies(parsedWallets);
      return parsedWallets;
    }
    
    console.log('📝 No wallet data found, starting fresh');
    return [];
  } catch (error) {
    console.error('Error loading wallets:', error);
    return [];
  }
};

export const saveConfigToCookies = (config: ConfigType) => {
  Cookies.set(CONFIG_COOKIE_KEY, JSON.stringify(config), { expires: 30 });
};

export const loadConfigFromCookies = (): ConfigType | null => {
  const savedConfig = Cookies.get(CONFIG_COOKIE_KEY);
  if (savedConfig) {
    try {
      return JSON.parse(savedConfig);
    } catch (error) {
      console.error('Error parsing saved config:', error);
      return null;
    }
  }
  return null;
};
export const formatTokenBalance = (balance: number | undefined): string => {
  if (balance === undefined) return '0.00';
  if (balance < 1000) return balance.toFixed(2);
  
  if (balance < 1_000_000) {
    return `${(balance / 1000).toFixed(1)}K`;
  }
  if (balance < 1_000_000_000) {
    return `${(balance / 1_000_000).toFixed(1)}M`;
  }
  return `${(balance / 1_000_000_000).toFixed(1)}B`;
};
export const downloadPrivateKey = (wallet: WalletType) => {
  const blob = new Blob([wallet.privateKey], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wallet-${wallet.address.slice(0, 8)}.key`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
export const downloadAllWallets = (wallets: WalletType[]) => {
  const formattedText = wallets.map(wallet => (
    `${wallet.address}\n` +
    `${wallet.privateKey}\n\n`
  )).join('');

  const blob = new Blob([formattedText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'wallets.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export interface QuickBuyPreferences {
  quickBuyEnabled: boolean;
  quickBuyAmount: number;
  quickBuyMinAmount: number;
  quickBuyMaxAmount: number;
  useQuickBuyRange: boolean;
}

export const saveQuickBuyPreferencesToCookies = (preferences: QuickBuyPreferences) => {
  Cookies.set(QUICK_BUY_COOKIE_KEY, JSON.stringify(preferences), { expires: 30 });
};

export const loadQuickBuyPreferencesFromCookies = (): QuickBuyPreferences | null => {
  const savedPreferences = Cookies.get(QUICK_BUY_COOKIE_KEY);
  if (savedPreferences) {
    try {
      return JSON.parse(savedPreferences);
    } catch (error) {
      console.error('Error parsing saved quick buy preferences:', error);
      return null;
    }
  }
  return null;
};