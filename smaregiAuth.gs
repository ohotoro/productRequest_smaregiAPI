// ===== smaregiAuth.gs - Smaregi API 인증 및 연결 관리 =====

/**
 * Smaregi API 인증 헤더 생성
 * @returns {Object} 인증 헤더
 */
function getSmaregiAuthHeaders() {
  return {
    'X-Contract-Id': CONFIG.SMAREGI.CONTRACT_ID,
    'X-Access-Token': CONFIG.SMAREGI.ACCESS_TOKEN,
    'Content-Type': 'application/json'
  };
}
/**
 * Smaregi API 연결 테스트
 * @returns {Object} 연결 상태
 */
function testSmaregiConnection() {
  try {
    console.log('=== Smaregi API 연결 테스트 시작 ===');
    
    // Platform API 사용 확인
    if (CONFIG && CONFIG.PLATFORM_CONFIG) {
      const config = getCurrentConfig();
      if (config.CLIENT_ID && config.CLIENT_SECRET) {
        console.log('Platform API 연결 테스트');
        return testPlatformConnection();
      }
    }
    
    // 기존 Legacy API 테스트
    const url = `${CONFIG.SMAREGI.API_BASE_URL}pos/stores`;
    const options = {
      method: 'GET',
      headers: getSmaregiAuthHeaders(),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    
    if (statusCode === 200) {
      const data = JSON.parse(response.getContentText());
      console.log(`연결 성공: ${data.length}개 매장 확인`);
      
      return {
        success: true,
        message: 'Smaregi API 연결 성공',
        stores: data.length,
        data: data
      };
    } else {
      console.error(`연결 실패: HTTP ${statusCode}`);
      return {
        success: false,
        message: `연결 실패: HTTP ${statusCode}`,
        error: response.getContentText()
      };
    }
    
  } catch (error) {
    console.error('Smaregi 연결 테스트 실패:', error);
    return {
      success: false,
      message: '연결 테스트 실패',
      error: error.toString()
    };
  }
}

/**
 * API 호출 래퍼 (재시도 로직 포함)
 * @param {string} endpoint - API 엔드포인트
 * @param {string} method - HTTP 메소드
 * @param {Object} payload - 요청 데이터
 * @param {number} retries - 재시도 횟수
 * @returns {Object} API 응답
 */
function callSmaregiAPI(endpoint, method = 'GET', payload = null, retries = 3) {
  const url = CONFIG.SMAREGI.API_BASE_URL + endpoint;
  
  const options = {
    method: method,
    headers: getSmaregiAuthHeaders(),
    muteHttpExceptions: true,
    timeout: CONFIG.SMAREGI.TIMEOUT / 1000 // 초 단위로 변환
  };
  
  if (payload) {
    options.payload = JSON.stringify(payload);
  }
  
  let lastError = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const statusCode = response.getResponseCode();
      const responseText = response.getContentText();
      
      if (statusCode >= 200 && statusCode < 300) {
        return {
          success: true,
          data: responseText ? JSON.parse(responseText) : null,
          statusCode: statusCode
        };
      } else if (statusCode === 429) {
        // Rate limit 처리
        console.log('Rate limit 도달, 대기 중...');
        Utilities.sleep(5000); // 5초 대기
        continue;
      } else {
        lastError = {
          statusCode: statusCode,
          message: responseText
        };
      }
      
    } catch (error) {
      lastError = error;
      console.error(`API 호출 실패 (시도 ${i + 1}/${retries}):`, error);
      
      if (i < retries - 1) {
        Utilities.sleep(1000 * (i + 1)); // 지수 백오프
      }
    }
  }
  
  return {
    success: false,
    error: lastError,
    message: 'API 호출 실패'
  };
}

/**
 * 매장 목록 조회
 * @returns {Array} 매장 목록
 */
function getSmaregiStores() {
  try {
    const cached = getCache('smaregi_stores');
    if (cached) return cached;
    
    const result = callSmaregiAPI('pos/stores');
    
    if (result.success) {
      // 캐시 저장 (1시간)
      setCache('smaregi_stores', result.data, CACHE_DURATION.LONG);
      return result.data;
    }
    
    return [];
    
  } catch (error) {
    console.error('매장 목록 조회 실패:', error);
    return [];
  }
}

/**
 * 기본 매장 ID 가져오기
 * @returns {string} 매장 ID
 */
function getDefaultStoreId() {
  const stores = getSmaregiStores();
  if (stores && stores.length > 0) {
    // 첫 번째 활성 매장 반환
    const activeStore = stores.find(store => store.isActive) || stores[0];
    return activeStore.storeId;
  }
  return null;
}

/**
 * API 사용량 확인
 * @returns {Object} 사용량 정보
 */
function getSmaregiAPIUsage() {
  try {
    const result = callSmaregiAPI('account/usage');
    
    if (result.success) {
      return {
        success: true,
        usage: result.data,
        remaining: result.data.rateLimit - result.data.requestCount,
        resetTime: new Date(result.data.resetTime)
      };
    }
    
    return {
      success: false,
      message: 'API 사용량 조회 실패'
    };
    
  } catch (error) {
    console.error('API 사용량 조회 실패:', error);
    return {
      success: false,
      error: error.toString()
    };
  }
}

/**
 * Smaregi 연결 상태 확인 (캐시 활용)
 * @returns {boolean} 연결 가능 여부
 */
function isSmaregiAvailable() {
  const cacheKey = 'smaregi_available';
  const cached = getCache(cacheKey);
  
  if (cached !== null) {
    return cached;
  }
  
  const result = testSmaregiConnection();
  const isAvailable = result.success;
  
  // 연결 상태 캐시 (5분)
  setCache(cacheKey, isAvailable, CACHE_DURATION.SHORT);
  
  return isAvailable;
}

/**
 * API 에러 처리
 * @param {Object} error - 에러 객체
 * @returns {string} 사용자 친화적 에러 메시지
 */
function handleSmaregiError(error) {
  if (error.statusCode === 401) {
    return '인증 실패: API 토큰을 확인해주세요.';
  } else if (error.statusCode === 403) {
    return '권한 없음: API 권한을 확인해주세요.';
  } else if (error.statusCode === 404) {
    return '데이터를 찾을 수 없습니다.';
  } else if (error.statusCode === 429) {
    return 'API 호출 한도 초과: 잠시 후 다시 시도해주세요.';
  } else if (error.statusCode >= 500) {
    return 'Smaregi 서버 오류: 잠시 후 다시 시도해주세요.';
  }
  
  return '알 수 없는 오류가 발생했습니다.';
}
