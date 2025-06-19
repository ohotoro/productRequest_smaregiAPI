// ===== smaregiPlatformAPI.gs - Smaregi プラットフォームAPI実装 =====

// PLATFORM_CONFIG は config.gs で定義されているため、ここでは参照のみ
function getCurrentConfig() {
  if (!CONFIG.PLATFORM_CONFIG) {
    throw new Error('PLATFORM_CONFIG が設定されていません');
  }
  
  const config = CONFIG.PLATFORM_CONFIG;
  const isProduction = config.USE_PRODUCTION;
  
  return {
    CONTRACT_ID: isProduction ? config.PROD_CONTRACT_ID : config.DEV_CONTRACT_ID,  // ← ここを修正!
    CLIENT_ID: isProduction ? config.PROD_CLIENT_ID : config.DEV_CLIENT_ID,
    CLIENT_SECRET: isProduction ? config.PROD_CLIENT_SECRET : config.DEV_CLIENT_SECRET,
    TOKEN_URL: isProduction ? config.PROD_TOKEN_URL : config.DEV_TOKEN_URL,
    API_BASE_URL: isProduction ? config.PROD_API_BASE_URL : config.DEV_API_BASE_URL,
    SCOPES: config.SCOPES,
    ENVIRONMENT: isProduction ? '本番環境' : '開発環境'
  };
}

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
    
    // Basic Authentication 생성
    const credentials = Utilities.base64Encode(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`);
    
    const payload = {
      grant_type: 'client_credentials',
      scope: config.SCOPES
    };
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: Object.keys(payload)
        .map(key => `${key}=${encodeURIComponent(payload[key])}`)
        .join('&'),
      muteHttpExceptions: true
    };
    
    console.log('요청 URL:', url);
    console.log('Authorization:', `Basic ${credentials.substring(0, 10)}...`);
    
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    console.log('응답 상태:', statusCode);
    
    if (statusCode === 200) {
      const tokenData = JSON.parse(responseText);
      
      // 有効期限を計算（通常1時間）
      tokenData.expires_at = new Date().getTime() + (tokenData.expires_in * 1000) - 60000;
      
      // キャッシュ保存
      setCache('platform_access_token', tokenData, tokenData.expires_in - 60);
      
      console.log('アクセストークン取得成功');
      return tokenData;
      
    } else {
      console.error('トークン取得失敗:', responseText);
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
    
    const config = getCurrentConfig();  // ← 이렇게 수정!
    const url = `${config.API_BASE_URL}${config.CONTRACT_ID}/${endpoint}`;
    
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

// smaregiPlatformAPI.gs에 추가
function debugProductionAuth() {
  console.log('=== 본번환경 인증 디버그 ===');
  
  // 현재 설정 확인
  const config = getCurrentConfig();
  console.log('CONTRACT_ID:', config.CONTRACT_ID);
  console.log('CLIENT_ID:', config.CLIENT_ID);
  console.log('환경:', config.ENVIRONMENT);
  
  // 토큰 URL 확인
  const tokenUrl = `${config.TOKEN_URL}${config.CONTRACT_ID}/token`;
  console.log('\n토큰 URL:', tokenUrl);
  
  // 다양한 방법으로 인증 시도
  const methods = [
    {
      name: '방법1: Basic Auth + 빈 스코프',
      headers: {
        'Authorization': `Basic ${Utilities.base64Encode(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: 'grant_type=client_credentials'
    },
    {
      name: '방법2: Body에 credentials',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: `grant_type=client_credentials&client_id=${config.CLIENT_ID}&client_secret=${config.CLIENT_SECRET}`
    }
  ];
  
  methods.forEach(method => {
    console.log(`\n--- ${method.name} ---`);
    try {
      const response = UrlFetchApp.fetch(tokenUrl, {
        method: 'POST',
        headers: method.headers,
        payload: method.payload,
        muteHttpExceptions: true
      });
      
      console.log('응답:', response.getResponseCode());
      if (response.getResponseCode() === 200) {
        console.log('✅ 성공!');
        const token = JSON.parse(response.getContentText());
        
        // 즉시 API 테스트
        testWithToken(token.access_token);
      } else {
        console.log('내용:', response.getContentText());
      }
    } catch (e) {
      console.error('오류:', e);
    }
  });
}

function testWithToken(accessToken) {
  console.log('\n토큰으로 API 테스트...');
  const config = getCurrentConfig();
  
  // 다른 URL 패턴 시도
  const urls = [
    `https://api.smaregi.jp/${config.CONTRACT_ID}/pos/stores`,
    `https://api.smaregi.jp/v1/${config.CONTRACT_ID}/pos/stores`,
    `https://api.smaregi.jp/platform/${config.CONTRACT_ID}/pos/stores`
  ];
  
  urls.forEach(url => {
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Contract-Id': config.CONTRACT_ID  // 추가 헤더
        },
        muteHttpExceptions: true
      });
      
      console.log(`\n${url}: ${response.getResponseCode()}`);
    } catch (e) {
      console.error('오류:', e);
    }
  });
}
