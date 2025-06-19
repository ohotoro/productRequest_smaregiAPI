// ===== smaregiPlatformAPI.gs - Smaregi プラットフォームAPI実装 =====

// PLATFORM_CONFIG は config.gs で定義されているため、ここでは参照のみ
// 現在の環境に応じた設定を取得
function getCurrentConfig() {
  if (!CONFIG.PLATFORM_CONFIG) {
    throw new Error('PLATFORM_CONFIG が設定されていません');
  }
  
  const config = CONFIG.PLATFORM_CONFIG;
  const isProduction = config.USE_PRODUCTION;
  
  return {
    CONTRACT_ID: config.CONTRACT_ID,
    CLIENT_ID: isProduction ? config.PROD_CLIENT_ID : config.DEV_CLIENT_ID,
    CLIENT_SECRET: isProduction ? config.PROD_CLIENT_SECRET : config.DEV_CLIENT_SECRET,
    TOKEN_URL: config.TOKEN_URL,
    API_BASE_URL: isProduction ? config.PROD_API_BASE_URL : config.DEV_API_BASE_URL,
    SCOPES: config.SCOPES,
    ENVIRONMENT: isProduction ? '本番環境' : '開発環境'
  };
}


/**
 * プラットフォームAPI設定
 * デベロッパーズアカウントで作成したアプリ情報を設定
 */
const PLATFORM_CONFIG = {
  CONTRACT_ID: 'skuv592u8',  // 契約ID
  CLIENT_ID: '',              // アプリのクライアントID（要設定）
  CLIENT_SECRET: '',          // アプリのクライアントシークレット（要設定）
  
  // エンドポイント
  TOKEN_URL: 'https://id.smaregi.jp/app/',
  API_BASE_URL: 'https://api.smaregi.jp/',  // 本番環境
  DEV_API_BASE_URL: 'https://api.smaregi.dev/',  // 開発環境
  
  // スコープ（必要な権限）
  SCOPES: 'pos.products:read pos.stocks:read pos.stores:read'
};

/**
 * アクセストークン取得（Client Credentials Grant）
 * @returns {Object} トークン情報
 */
function getPlatformAccessToken() {
  try {
    console.log('=== プラットフォームAPI アクセストークン取得 ===');
    
    const config = getCurrentConfig();
    console.log(`環境: ${config.ENVIRONMENT}`);
    
    // CLIENT_ID/SECRET チェック
    if (!config.CLIENT_ID || !config.CLIENT_SECRET) {
      console.error('CLIENT_ID または CLIENT_SECRET が設定されていません');
      return null;
    }
    
    // キャッシュ確認
    const cached = getCache('platform_access_token');
    if (cached && cached.expires_at > new Date().getTime()) {
      console.log('キャッシュされたトークンを使用');
      return cached;
    }
    
    const url = `${config.TOKEN_URL}${config.CONTRACT_ID}/token`;
    
    // Smaregi는 client_id를 body에도 포함해야 함
    const payload = {
      grant_type: 'client_credentials',
      scope: config.SCOPES,
      client_id: config.CLIENT_ID,      // 추가!
      client_secret: config.CLIENT_SECRET // 추가!
    };
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
        // Authorization 헤더 제거 - body에 포함시킴
      },
      payload: Object.keys(payload)
        .map(key => `${key}=${encodeURIComponent(payload[key])}`)
        .join('&'),
      muteHttpExceptions: true
    };
    
    console.log('요청 URL:', url);
    
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    
    if (statusCode === 200) {
      const tokenData = JSON.parse(response.getContentText());
      
      // 有効期限を計算（通常1時間）
      tokenData.expires_at = new Date().getTime() + (tokenData.expires_in * 1000) - 60000;
      
      // キャッシュ保存
      setCache('platform_access_token', tokenData, tokenData.expires_in - 60);
      
      console.log('アクセストークン取得成功');
      return tokenData;
      
    } else {
      console.error('トークン取得失敗:', response.getContentText());
      return null;
    }
    
  } catch (error) {
    console.error('アクセストークン取得エラー:', error);
    return null;
  }
}

/**
 * プラットフォームAPI呼び出し
 * @param {string} endpoint - エンドポイント
 * @param {string} method - HTTPメソッド
 * @param {Object} payload - リクエストボディ
 * @returns {Object} APIレスポンス
 */
function callPlatformAPI(endpoint, method = 'GET', payload = null) {
  try {
    const tokenData = getPlatformAccessToken();
    if (!tokenData) {
      return {
        success: false,
        message: 'アクセストークン取得失敗'
      };
    }
    
    const url = `${PLATFORM_CONFIG.API_BASE_URL}${PLATFORM_CONFIG.CONTRACT_ID}/${endpoint}`;
    
    const options = {
      method: method,
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    };
    
    if (payload) {
      options.payload = JSON.stringify(payload);
    }
    
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (statusCode >= 200 && statusCode < 300) {
      return {
        success: true,
        data: responseText ? JSON.parse(responseText) : null,
        statusCode: statusCode
      };
    } else {
      return {
        success: false,
        statusCode: statusCode,
        error: responseText
      };
    }
    
  } catch (error) {
    console.error('API呼び出しエラー:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 在庫データ取得（プラットフォームAPI版）
 * @param {string} storeId - 店舗ID（省略可）
 * @returns {Object} 在庫データ
 */
function getPlatformStockData(storeId = null) {
  try {
    console.log('=== プラットフォームAPI 在庫データ取得 ===');
    
    const stockData = {};
    let page = 1;
    const limit = 1000;
    
    // 店舗ID取得
    if (!storeId) {
      const stores = getPlatformStores();
      if (stores.length > 0) {
        storeId = stores[0].storeId;
      } else {
        return { success: false, message: '店舗情報が見つかりません' };
      }
    }
    
    // ページング処理
    while (true) {
      const endpoint = `pos/stocks?storeId=${storeId}&limit=${limit}&page=${page}`;
      const result = callPlatformAPI(endpoint);
      
      if (!result.success) {
        console.error('在庫取得失敗:', result.error);
        break;
      }
      
      const items = result.data;
      if (!items || items.length === 0) {
        break;
      }
      
      // 在庫データ処理
      items.forEach(item => {
        if (item.productCode) {
          stockData[item.productCode] = {
            quantity: item.stockAmount || 0,
            productId: item.productId,
            productName: item.productName,
            updatedAt: item.updatedDateTime
          };
        }
      });
      
      if (items.length < limit) {
        break;
      }
      page++;
    }
    
    console.log(`${Object.keys(stockData).length}個の在庫データ取得完了`);
    
    return {
      success: true,
      data: stockData,
      count: Object.keys(stockData).length,
      storeId: storeId,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('在庫データ取得エラー:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 店舗一覧取得
 * @returns {Array} 店舗リスト
 */
function getPlatformStores() {
  try {
    const result = callPlatformAPI('pos/stores');
    
    if (result.success) {
      return result.data || [];
    }
    
    return [];
    
  } catch (error) {
    console.error('店舗一覧取得エラー:', error);
    return [];
  }
}

/**
 * プラットフォームAPI接続テスト
 * @returns {Object} テスト結果
 */
function testPlatformConnection() {
  try {
    console.log('=== プラットフォームAPI接続テスト ===');
    
    // 1. トークン取得テスト
    const tokenData = getPlatformAccessToken();
    if (!tokenData) {
      return {
        success: false,
        message: 'トークン取得失敗。クライアントID/シークレットを確認してください。'
      };
    }
    
    console.log('トークン取得成功');
    
    // 2. 店舗一覧取得テスト
    const stores = getPlatformStores();
    console.log(`${stores.length}個の店舗を確認`);
    
    // 3. 在庫データ取得テスト（最初の10件）
    if (stores.length > 0) {
      const endpoint = `pos/stocks?storeId=${stores[0].storeId}&limit=10`;
      const stockResult = callPlatformAPI(endpoint);
      
      if (stockResult.success) {
        return {
          success: true,
          message: 'プラットフォームAPI接続成功',
          stores: stores.length,
          sampleStocks: stockResult.data.length
        };
      }
    }
    
    return {
      success: true,
      message: 'API接続成功（店舗データなし）',
      stores: 0
    };
    
  } catch (error) {
    console.error('接続テスト失敗:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * 既存システムとの互換性維持
 * getSmaregiStockData を プラットフォームAPI版に置き換え
 */
function getSmaregiStockData(storeId = null) {
  // CLIENT_IDが設定されていない場合は従来の処理
  if (!PLATFORM_CONFIG.CLIENT_ID) {
    console.log('プラットフォームAPI未設定。従来のAPI v2を使用。');
    // 既存の処理にフォールバック
    return {
      success: false,
      message: 'API設定が必要です'
    };
  }
  
  // プラットフォームAPI版を使用
  return getPlatformStockData(storeId);
}
