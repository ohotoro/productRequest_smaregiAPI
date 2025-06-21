// smaregiPlatformAPI.gs 수정 - 재고 데이터 가져오기 (await 제거 버전)
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
        console.log('デフォルト店舗ID:', storeId);
      } else {
        return { success: false, message: '店舗情報が見つかりません' };
      }
    }
    
    // ページング処理
    while (true) {
      // 正しいエンドポイントとパラメータ形式を使用
      const endpoint = `pos/stock?store_id=${storeId}&limit=${limit}&page=${page}`;
      const result = callPlatformAPI(endpoint);
      
      if (!result.success) {
        console.error('在庫取得失敗:', result.error);
        break;
      }
      
      const items = result.data;
      if (!items || items.length === 0) {
        break;
      }
      
      // 在庫データ処理 - productId を productCode にマッピング
      items.forEach(item => {
        // productId から商品情報を取得してバーコードを特定
        const productCode = getProductCodeById(item.productId);
        
        if (productCode) {
          stockData[productCode] = {
            quantity: parseInt(item.stockAmount) || 0,
            layawayQuantity: parseInt(item.layawayStockAmount) || 0,
            availableQuantity: parseInt(item.stockAmount) - parseInt(item.layawayStockAmount),
            productId: item.productId,
            storeId: item.storeId,
            updatedAt: item.updDateTime
          };
        }
      });
      
      console.log(`ページ ${page}: ${items.length}件処理`);
      
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

// ===== smaregiPlatformAPI.gs - 필수 함수들 =====

// getCurrentConfig 함수 - Platform API 설정 가져오기
function getCurrentConfig() {
  if (!CONFIG || !CONFIG.PLATFORM_CONFIG) {
    console.error('PLATFORM_CONFIG가 설정되지 않았습니다');
    throw new Error('PLATFORM_CONFIG が設定されていません');
  }
  
  const config = CONFIG.PLATFORM_CONFIG;
  const isProduction = config.USE_PRODUCTION;
  
  return {
    CONTRACT_ID: isProduction ? config.PROD_CONTRACT_ID : config.DEV_CONTRACT_ID,
    CLIENT_ID: isProduction ? config.PROD_CLIENT_ID : config.DEV_CLIENT_ID,
    CLIENT_SECRET: isProduction ? config.PROD_CLIENT_SECRET : config.DEV_CLIENT_SECRET,
    TOKEN_URL: isProduction ? config.PROD_TOKEN_URL : config.DEV_TOKEN_URL,
    API_BASE_URL: isProduction ? config.PROD_API_BASE_URL : config.DEV_API_BASE_URL,
    SCOPES: config.SCOPES,
    ENVIRONMENT: isProduction ? '本番環境' : '開発環境'
  };
}

// getPlatformAccessToken 함수 - 토큰 발급
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
    
    // 스코프 포함
    const formData = {
      'grant_type': 'client_credentials',
      'scope': config.SCOPES
    };
    
    const payload = Object.keys(formData)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(formData[key])}`)
      .join('&');
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: payload,
      muteHttpExceptions: true
    };
    
    console.log('토큰 요청 URL:', url);
    
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    console.log('応답 상태:', statusCode);
    
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

// callPlatformAPI 함수 - API 호출
function callPlatformAPI(endpoint, method = 'GET', payload = null) {
  try {
    const tokenData = getPlatformAccessToken();
    if (!tokenData) {
      return {
        success: false,
        message: 'アクセストークン取得失敗'
      };
    }
    
    const config = getCurrentConfig();
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

// getPlatformStores 함수 - 매장 목록 조회
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

// testPlatformConnection 함수 - 연결 테스트
function testPlatformConnection() {
  try {
    console.log('=== Platform API 연결 테스트 ===');
    
    // 토큰 발급 테스트
    const tokenData = getPlatformAccessToken();
    
    if (!tokenData) {
      return {
        success: false,
        message: '토큰 발급 실패'
      };
    }
    
    console.log('토큰 스코프:', tokenData.scope);
    
    // 매장 조회로 연결 확인
    const result = callPlatformAPI('pos/stores');
    
    if (result.success) {
      console.log(`✅ 연결 성공: ${result.data.length}개 매장`);
      return {
        success: true,
        message: 'Platform API 연결 성공',
        stores: result.data.length,
        data: result.data
      };
    } else {
      console.error('❌ API 호출 실패:', result.error);
      return {
        success: false,
        message: `API 호출 실패: ${result.statusCode}`,
        error: result.error
      };
    }
    
  } catch (error) {
    console.error('Platform API 테스트 실패:', error);
    return {
      success: false,
      message: '연결 테스트 실패',
      error: error.toString()
    };
  }
}

// productId から productCode を取得するヘルパー関数
function getProductCodeById(productId) {
  try {
    // キャッシュチェック
    const cacheKey = `product_${productId}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return cached.productCode;
    }
    
    // 個別商品取得
    const result = callPlatformAPI(`pos/products/${productId}`);
    
    if (result.success && result.data) {
      // キャッシュ保存
      setCache(cacheKey, {
        productCode: result.data.productCode,
        productName: result.data.productName
      }, 3600); // 1時間
      
      return result.data.productCode;
    }
    
    return null;
    
  } catch (error) {
    console.error(`商品コード取得エラー (ID: ${productId}):`, error);
    return null;
  }
}

// より効率的なバージョン - 商品情報を事前に一括取得
function getPlatformStockDataOptimized(storeId = null) {
  try {
    console.log('=== 最適化版：在庫データ取得 ===');
    
    // 1. まず全商品情報を取得してマッピング作成
    const productMap = getAllProductsMap();
    
    // 2. 店舗ID取得
    if (!storeId) {
      const stores = getPlatformStores();
      if (stores.length > 0) {
        storeId = stores[0].storeId;
      } else {
        return { success: false, message: '店舗情報が見つかりません' };
      }
    }
    
    // 3. 在庫データ取得
    const stockData = {};
    let page = 1;
    const limit = 1000;
    
    while (true) {
      const endpoint = `pos/stock?store_id=${storeId}&limit=${limit}&page=${page}`;
      const result = callPlatformAPI(endpoint);
      
      if (!result.success) {
        console.error('在庫取得失敗:', result.error);
        break;
      }
      
      const items = result.data;
      if (!items || items.length === 0) {
        break;
      }
      
      // productMap を使って効率的にマッピング
      items.forEach(item => {
        const productInfo = productMap[item.productId];
        
        if (productInfo) {
          stockData[productInfo.productCode] = {
            quantity: parseInt(item.stockAmount) || 0,
            layawayQuantity: parseInt(item.layawayStockAmount) || 0,
            availableQuantity: parseInt(item.stockAmount) - parseInt(item.layawayStockAmount),
            productId: item.productId,
            productName: productInfo.productName,
            storeId: item.storeId,
            updatedAt: item.updDateTime
          };
        }
      });
      
      if (items.length < limit) {
        break;
      }
      page++;
    }
    
    console.log(`${Object.keys(stockData).length}個の在庫データ取得完了`);
    
    // キャッシュに保存
    setCache('platform_stock_data', stockData, 300); // 5分
    
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

// 全商品のマッピングを作成
function getAllProductsMap() {
  try {
    // キャッシュチェック
    const cached = getCache('all_products_map');
    if (cached) {
      console.log('キャッシュから商品マップ取得');
      return cached;
    }
    
    console.log('全商品情報取得中...');
    const productMap = {};
    let page = 1;
    const limit = 1000;
    
    while (true) {
      const result = callPlatformAPI(`pos/products?limit=${limit}&page=${page}`);
      
      if (!result.success || !result.data || result.data.length === 0) {
        break;
      }
      
      result.data.forEach(product => {
        productMap[product.productId] = {
          productCode: product.productCode,
          productName: product.productName
        };
      });
      
      console.log(`ページ ${page}: ${result.data.length}件の商品`);
      
      if (result.data.length < limit) {
        break;
      }
      page++;
    }
    
    console.log(`${Object.keys(productMap).length}個の商品マッピング作成完了`);
    
    // キャッシュ保存（1時間）
    setCache('all_products_map', productMap, 3600);
    
    return productMap;
    
  } catch (error) {
    console.error('商品マップ作成エラー:', error);
    return {};
  }
}

// 特定バーコードの在庫を取得
function getPlatformStockByBarcode(barcode, storeId = null) {
  try {
    // まず商品情報を取得
    const productResult = callPlatformAPI(`pos/products?limit=1&product_code=${barcode}`);
    
    if (!productResult.success || !productResult.data || productResult.data.length === 0) {
      return {
        success: false,
        message: '商品が見つかりません',
        stock: 0
      };
    }
    
    const product = productResult.data[0];
    const productId = product.productId;
    
    // 在庫を取得
    let endpoint = `pos/stock?product_id=${productId}`;
    if (storeId) {
      endpoint += `&store_id=${storeId}`;
    }
    
    const stockResult = callPlatformAPI(endpoint);
    
    if (stockResult.success && stockResult.data && stockResult.data.length > 0) {
      const stockInfo = stockResult.data[0];
      
      return {
        success: true,
        barcode: barcode,
        stock: parseInt(stockInfo.stockAmount) || 0,
        layawayStock: parseInt(stockInfo.layawayStockAmount) || 0,
        availableStock: parseInt(stockInfo.stockAmount) - parseInt(stockInfo.layawayStockAmount),
        productName: product.productName,
        storeId: stockInfo.storeId,
        updatedAt: stockInfo.updDateTime
      };
    }
    
    return {
      success: true,
      barcode: barcode,
      stock: 0,
      message: '在庫情報がありません'
    };
    
  } catch (error) {
    console.error('バーコード在庫取得エラー:', error);
    return {
      success: false,
      barcode: barcode,
      stock: 0,
      error: error.toString()
    };
  }
}

// テスト関数
function testNewStockAPI() {
  console.log('=== 新しい在庫API テスト ===');
  
  // 1. 全体在庫取得テスト
  console.log('\n1. 最適化版在庫取得テスト');
  const stockResult = getPlatformStockDataOptimized();
  
  if (stockResult.success) {
    console.log(`✅ 成功: ${stockResult.count}個の在庫データ`);
    
    // サンプル表示
    const samples = Object.entries(stockResult.data).slice(0, 3);
    samples.forEach(([code, data]) => {
      console.log(`\nバーコード: ${code}`);
      console.log(`商品名: ${data.productName}`);
      console.log(`在庫数: ${data.quantity}`);
      console.log(`予約数: ${data.layawayQuantity}`);
      console.log(`利用可能数: ${data.availableQuantity}`);
    });
  } else {
    console.error('❌ 失敗:', stockResult.error);
  }
  
  // 2. 個別在庫取得テスト
  console.log('\n2. バーコード個別在庫テスト');
  const testBarcode = '1000008038';
  const individualResult = getPlatformStockByBarcode(testBarcode);
  
  if (individualResult.success) {
    console.log(`✅ バーコード ${testBarcode} の在庫:`, individualResult.stock);
  } else {
    console.error('❌ 失敗:', individualResult.message);
  }
}

// Smaregi 재고 데이터 가져오기 - 웹앱에서 사용
function getSmaregiStockData() {
  try {
    // 플랫폼 API 사용
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        console.log('Platform API로 재고 조회');
        const result = getPlatformStockDataOptimized();
        
        if (result.success) {
          return {
            success: true,
            data: result.data,
            count: result.count,
            storeId: result.storeId,
            source: 'platform'
          };
        }
      }
    }
    
    // Legacy API fallback
    console.log('Platform API 재고 조회 실패');
    return {
      success: false,
      message: 'Platform API 재고 조회 실패'
    };
    
  } catch (error) {
    console.error('재고 데이터 조회 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

// 재고 조회 - 바코드별
function getSmaregiStockByBarcode(barcode) {
  try {
    // Platform API 사용
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      return getPlatformStockByBarcode(barcode);
    }
    
    // Legacy fallback
    return {
      success: false,
      barcode: barcode,
      stock: 0,
      message: 'API 연결 실패'
    };
    
  } catch (error) {
    console.error('바코드 재고 조회 실패:', error);
    return {
      success: false,
      barcode: barcode,
      stock: 0,
      error: error.toString()
    };
  }
}

/**
 * Smaregi API 연결 재설정
 * @returns {Object} 재연결 결과
 */
function resetSmaregiConnection() {
  try {
    console.log('=== Smaregi API 재연결 시작 ===');
    
    // 1. 캐시 초기화
    clearAllSmaregiCache();
    
    // 2. 토큰 재발급
    const cache = CacheService.getScriptCache();
    cache.remove('platform_access_token');
    
    // 3. 연결 테스트
    const connectionResult = checkSmaregiConnection();
    
    if (connectionResult.connected) {
      console.log('✅ API 재연결 성공');
      
      // 4. 초기 데이터 로드 (선택사항)
      const stockResult = getSmaregiStockData();
      
      return {
        success: true,
        message: 'API 연결이 복구되었습니다.',
        connected: true,
        apiType: connectionResult.apiType,
        itemCount: stockResult.success ? stockResult.count : 0
      };
    } else {
      console.error('❌ API 재연결 실패');
      return {
        success: false,
        message: 'API 연결 실패. 설정을 확인해주세요.',
        connected: false,
        error: connectionResult.error
      };
    }
    
  } catch (error) {
    console.error('재연결 중 오류:', error);
    return {
      success: false,
      message: '재연결 중 오류가 발생했습니다.',
      connected: false,
      error: error.toString()
    };
  }
}

/**
 * 모든 Smaregi 관련 캐시 삭제
 */
function clearAllSmaregiCache() {
  try {
    const cache = CacheService.getScriptCache();
    
    // 삭제할 캐시 키들
    const cacheKeys = [
      'platform_access_token',
      'all_products_map',
      'platform_stock_data',
      'smaregi_stores',
      'smaregi_available',
      'smaregi_stock_all'
    ];
    
    // 추가로 패턴에 맞는 캐시도 삭제
    const patterns = [
      'smaregi_stock_',
      'product_',
      'sales_data_'
    ];
    
    // 개별 키 삭제
    cacheKeys.forEach(key => {
      try {
        cache.remove(key);
        console.log(`캐시 삭제: ${key}`);
      } catch (e) {
        // 캐시 키가 없어도 무시
      }
    });
    
    console.log('✅ 모든 Smaregi 캐시 삭제 완료');
    
  } catch (error) {
    console.error('캐시 삭제 실패:', error);
  }
}

// getCurrentConfig 함수 - Platform API 설정 가져오기
function getCurrentConfig() {
  if (!CONFIG || !CONFIG.PLATFORM_CONFIG) {
    console.error('PLATFORM_CONFIG가 설정되지 않았습니다');
    throw new Error('PLATFORM_CONFIG が設定されていません');
  }
  
  const config = CONFIG.PLATFORM_CONFIG;
  const isProduction = config.USE_PRODUCTION;
  
  return {
    CONTRACT_ID: isProduction ? config.PROD_CONTRACT_ID : config.DEV_CONTRACT_ID,
    CLIENT_ID: isProduction ? config.PROD_CLIENT_ID : config.DEV_CLIENT_ID,
    CLIENT_SECRET: isProduction ? config.PROD_CLIENT_SECRET : config.DEV_CLIENT_SECRET,
    TOKEN_URL: isProduction ? config.PROD_TOKEN_URL : config.DEV_TOKEN_URL,
    API_BASE_URL: isProduction ? config.PROD_API_BASE_URL : config.DEV_API_BASE_URL,
    SCOPES: config.SCOPES,
    ENVIRONMENT: isProduction ? '本番環境' : '開発環境'
  };
}
