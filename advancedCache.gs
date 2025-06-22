// ===== 고급 캐싱 시스템 =====

/**
 * 계층적 캐시 시스템
 * L1: 메모리 (런타임)
 * L2: CacheService (스크립트 캐시)
 * L3: PropertiesService (영구 저장)
 */
const HierarchicalCache = {
  // L1 메모리 캐시 (런타임 동안만 유효)
  memory: new Map(),
  
  // 캐시 설정
  config: {
    memoryMaxSize: 1000,      // 메모리 캐시 최대 항목 수
    memoryTTL: 60000,         // 메모리 캐시 TTL (1분)
    scriptCacheTTL: 3600,     // 스크립트 캐시 TTL (1시간)
    persistentTTL: 86400      // 영구 저장 TTL (24시간)
  },
  
  /**
   * 데이터 가져오기 (계층적 조회)
   * @param {string} key - 캐시 키
   * @param {Function} fetchFn - 데이터 가져오기 함수
   * @param {Object} options - 캐시 옵션
   */
  async get(key, fetchFn = null, options = {}) {
    const startTime = Date.now();
    
    // L1: 메모리 캐시 확인
    const memoryData = this.getFromMemory(key);
    if (memoryData !== null) {
      this.recordHit('memory', Date.now() - startTime);
      return memoryData;
    }
    
    // L2: 스크립트 캐시 확인
    const scriptData = this.getFromScriptCache(key);
    if (scriptData !== null) {
      this.recordHit('script', Date.now() - startTime);
      // 메모리 캐시에도 저장
      this.setToMemory(key, scriptData, options.memoryTTL);
      return scriptData;
    }
    
    // L3: 영구 저장소 확인
    const persistentData = this.getFromPersistent(key);
    if (persistentData !== null) {
      this.recordHit('persistent', Date.now() - startTime);
      // 상위 캐시에도 저장
      this.setToMemory(key, persistentData, options.memoryTTL);
      this.setToScriptCache(key, persistentData, options.scriptTTL);
      return persistentData;
    }
    
    // 캐시 미스 - 데이터 가져오기
    this.recordMiss(Date.now() - startTime);
    
    if (fetchFn) {
      try {
        const freshData = await fetchFn();
        
        // 모든 레벨에 저장
        this.set(key, freshData, options);
        
        return freshData;
      } catch (error) {
        console.error('데이터 가져오기 실패:', error);
        throw error;
      }
    }
    
    return null;
  },
  
  /**
   * 데이터 저장 (모든 레벨)
   */
  set(key, value, options = {}) {
    const ttl = {
      memory: options.memoryTTL || this.config.memoryTTL,
      script: options.scriptTTL || this.config.scriptCacheTTL,
      persistent: options.persistentTTL || this.config.persistentTTL
    };
    
    // 각 레벨에 저장
    this.setToMemory(key, value, ttl.memory);
    this.setToScriptCache(key, value, ttl.script);
    
    // 중요 데이터만 영구 저장
    if (options.persistent !== false) {
      this.setToPersistent(key, value, ttl.persistent);
    }
  },
  
  /**
   * L1: 메모리 캐시 작업
   */
  getFromMemory(key) {
    const item = this.memory.get(key);
    
    if (item) {
      const age = Date.now() - item.timestamp;
      if (age < item.ttl) {
        return item.value;
      }
      // 만료된 항목 제거
      this.memory.delete(key);
    }
    
    return null;
  },
  
  setToMemory(key, value, ttl) {
    // 크기 제한 확인
    if (this.memory.size >= this.config.memoryMaxSize) {
      // LRU 정책: 가장 오래된 항목 제거
      const oldestKey = this.memory.keys().next().value;
      this.memory.delete(oldestKey);
    }
    
    this.memory.set(key, {
      value: value,
      timestamp: Date.now(),
      ttl: ttl || this.config.memoryTTL
    });
  },
  
  /**
   * L2: 스크립트 캐시 작업
   */
  getFromScriptCache(key) {
    try {
      const cache = CacheService.getScriptCache();
      const cached = cache.get(key);
      
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (e) {
          // JSON이 아닌 경우 그대로 반환
          return cached;
        }
      }
    } catch (error) {
      console.error('스크립트 캐시 읽기 실패:', error);
    }
    
    return null;
  },
  
  setToScriptCache(key, value, ttl) {
    try {
      const cache = CacheService.getScriptCache();
      const data = typeof value === 'object' ? JSON.stringify(value) : value;
      
      cache.put(key, data, ttl || this.config.scriptCacheTTL);
    } catch (error) {
      console.error('스크립트 캐시 쓰기 실패:', error);
    }
  },
  
  /**
   * L3: 영구 저장소 작업
   */
  getFromPersistent(key) {
    try {
      const properties = PropertiesService.getUserProperties();
      const data = properties.getProperty(`cache_${key}`);
      
      if (data) {
        const parsed = JSON.parse(data);
        const age = Date.now() - parsed.timestamp;
        
        if (age < parsed.ttl) {
          return parsed.value;
        }
        
        // 만료된 데이터 삭제
        properties.deleteProperty(`cache_${key}`);
      }
    } catch (error) {
      console.error('영구 저장소 읽기 실패:', error);
    }
    
    return null;
  },
  
  setToPersistent(key, value, ttl) {
    try {
      const properties = PropertiesService.getUserProperties();
      
      const data = {
        value: value,
        timestamp: Date.now(),
        ttl: ttl || this.config.persistentTTL
      };
      
      properties.setProperty(`cache_${key}`, JSON.stringify(data));
    } catch (error) {
      console.error('영구 저장소 쓰기 실패:', error);
    }
  },
  
  /**
   * 캐시 무효화
   */
  invalidate(key) {
    // 모든 레벨에서 제거
    this.memory.delete(key);
    
    try {
      CacheService.getScriptCache().remove(key);
    } catch (e) {}
    
    try {
      PropertiesService.getUserProperties().deleteProperty(`cache_${key}`);
    } catch (e) {}
  },
  
  /**
   * 패턴 기반 무효화
   */
  invalidatePattern(pattern) {
    // 메모리 캐시
    for (const key of this.memory.keys()) {
      if (key.includes(pattern)) {
        this.memory.delete(key);
      }
    }
    
    // 스크립트/영구 캐시는 전체 키를 알 수 없으므로 제한적
    console.log(`패턴 '${pattern}'에 해당하는 캐시 무효화`);
  },
  
  /**
   * 캐시 통계
   */
  stats: {
    hits: { memory: 0, script: 0, persistent: 0 },
    misses: 0,
    latency: { memory: [], script: [], persistent: [] }
  },
  
  recordHit(level, latency) {
    this.stats.hits[level]++;
    this.stats.latency[level].push(latency);
    
    // 최근 100개만 유지
    if (this.stats.latency[level].length > 100) {
      this.stats.latency[level].shift();
    }
  },
  
  recordMiss(latency) {
    this.stats.misses++;
  },
  
  getStats() {
    const total = Object.values(this.stats.hits).reduce((a, b) => a + b, 0) + this.stats.misses;
    
    return {
      total: total,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? ((total - this.stats.misses) / total * 100).toFixed(2) + '%' : '0%',
      avgLatency: {
        memory: this.getAvgLatency(this.stats.latency.memory),
        script: this.getAvgLatency(this.stats.latency.script),
        persistent: this.getAvgLatency(this.stats.latency.persistent)
      }
    };
  },
  
  getAvgLatency(latencies) {
    if (latencies.length === 0) return 0;
    const sum = latencies.reduce((a, b) => a + b, 0);
    return Math.round(sum / latencies.length);
  }
};

/**
 * 예측적 캐시 프리페칭
 */
const PredictiveCache = {
  // 사용 패턴 추적
  accessHistory: [],
  maxHistorySize: 1000,
  
  /**
   * 접근 기록
   */
  recordAccess(key, context = {}) {
    this.accessHistory.push({
      key: key,
      timestamp: Date.now(),
      context: context // 시간대, 사용자 행동 등
    });
    
    // 크기 제한
    if (this.accessHistory.length > this.maxHistorySize) {
      this.accessHistory.shift();
    }
    
    // 패턴 분석 및 프리페칭
    this.analyzePatternsAndPrefetch(key);
  },
  
  /**
   * 패턴 분석 및 프리페칭
   */
  analyzePatternsAndPrefetch(currentKey) {
    // 연관 상품 찾기
    const relatedKeys = this.findRelatedKeys(currentKey);
    
    // 시간 기반 패턴 찾기
    const timeBasedKeys = this.findTimeBasedPatterns();
    
    // 프리페칭 실행
    const toPrefetch = [...new Set([...relatedKeys, ...timeBasedKeys])];
    
    if (toPrefetch.length > 0) {
      console.log(`프리페칭: ${toPrefetch.length}개 항목`);
      this.prefetchItems(toPrefetch);
    }
  },
  
  /**
   * 연관 키 찾기 (순차 패턴)
   */
  findRelatedKeys(currentKey) {
    const related = [];
    
    // 현재 키 다음에 자주 접근되는 키 찾기
    for (let i = 0; i < this.accessHistory.length - 1; i++) {
      if (this.accessHistory[i].key === currentKey) {
        const nextKey = this.accessHistory[i + 1].key;
        related.push(nextKey);
      }
    }
    
    // 빈도수 계산
    const frequency = {};
    related.forEach(key => {
      frequency[key] = (frequency[key] || 0) + 1;
    });
    
    // 상위 5개 반환
    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key]) => key);
  },
  
  /**
   * 시간 기반 패턴 찾기
   */
  findTimeBasedPatterns() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();
    
    // 같은 시간대에 자주 접근되는 키
    const sameTimeKeys = this.accessHistory
      .filter(record => {
        const recordDate = new Date(record.timestamp);
        return Math.abs(recordDate.getHours() - currentHour) <= 1;
      })
      .map(record => record.key);
    
    // 빈도수 계산
    const frequency = {};
    sameTimeKeys.forEach(key => {
      frequency[key] = (frequency[key] || 0) + 1;
    });
    
    // 상위 3개 반환
    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key]) => key);
  },
  
  /**
   * 아이템 프리페칭
   */
  async prefetchItems(keys) {
    // 백그라운드에서 캐시 로드
    keys.forEach(async (key) => {
      // 이미 캐시에 있는지 확인
      const cached = HierarchicalCache.getFromMemory(key);
      
      if (!cached) {
        // 캐시에 없으면 로드 (낮은 우선순위)
        try {
          // key가 바코드라고 가정
          await getStockDataWithCache(key);
        } catch (error) {
          // 프리페칭 실패는 조용히 처리
          console.log(`프리페칭 실패: ${key}`);
        }
      }
    });
  }
};

/**
 * 캐시 워밍 스케줄러
 */
const CacheWarmingScheduler = {
  /**
   * 캐시 워밍 실행
   */
  async warmCache() {
    console.log('캐시 워밍 시작');
    const startTime = Date.now();
    
    try {
      // 1. 자주 발주하는 상품
      const frequentItems = await this.warmFrequentItems();
      
      // 2. 최근 발주한 상품
      const recentItems = await this.warmRecentItems();
      
      // 3. 안전재고 설정 상품
      const safetyStockItems = await this.warmSafetyStockItems();
      
      const totalWarmed = frequentItems + recentItems + safetyStockItems;
      const elapsed = Date.now() - startTime;
      
      console.log(`캐시 워밍 완료: ${totalWarmed}개 항목, ${elapsed}ms`);
      
      return {
        success: true,
        warmedCount: totalWarmed,
        elapsed: elapsed,
        details: {
          frequent: frequentItems,
          recent: recentItems,
          safetyStock: safetyStockItems
        }
      };
      
    } catch (error) {
      console.error('캐시 워밍 실패:', error);
      throw error;
    }
  },
  
  /**
   * 자주 발주하는 상품 캐시
   */
  async warmFrequentItems() {
    const barcodes = getFrequentProductBarcodes().slice(0, 30);
    
    if (barcodes.length === 0) return 0;
    
    // 배치로 처리
    const results = await batchGetStockDataWithCache(barcodes);
    
    return Object.keys(results).length;
  },
  
  /**
   * 최근 발주 상품 캐시
   */
  async warmRecentItems() {
    const recentOrders = getRecentOrderItems(7); // 최근 7일
    const barcodes = [...new Set(recentOrders.map(item => item.barcode))].slice(0, 20);
    
    if (barcodes.length === 0) return 0;
    
    const results = await batchGetStockDataWithCache(barcodes);
    
    return Object.keys(results).length;
  },
  
  /**
   * 안전재고 설정 상품 캐시
   */
  async warmSafetyStockItems() {
    const safetyStockItems = getSafetyStockItems();
    const barcodes = safetyStockItems.map(item => item.barcode).slice(0, 20);
    
    if (barcodes.length === 0) return 0;
    
    const results = await batchGetStockDataWithCache(barcodes);
    
    return Object.keys(results).length;
  },
  
  /**
   * 스케줄 기반 캐시 워밍 설정
   */
  setupSchedule() {
    // 매일 새벽 3시에 캐시 워밍
    ScriptApp.newTrigger('scheduledCacheWarming')
      .timeBased()
      .everyDays(1)
      .atHour(3)
      .create();
    
    // 피크 시간 전 캐시 워밍 (오전 9시, 오후 2시)
    ScriptApp.newTrigger('peakTimeCacheWarming')
      .timeBased()
      .everyDays(1)
      .atHour(9)
      .create();
    
    ScriptApp.newTrigger('peakTimeCacheWarming')
      .timeBased()
      .everyDays(1)
      .atHour(14)
      .create();
    
    console.log('캐시 워밍 스케줄 설정 완료');
  }
};

/**
 * 트리거 함수: 스케줄된 캐시 워밍
 */
function scheduledCacheWarming() {
  try {
    console.log('스케줄된 캐시 워밍 시작');
    const result = CacheWarmingScheduler.warmCache();
    
    // 결과 로깅
    console.log('캐시 워밍 결과:', result);
    
  } catch (error) {
    console.error('스케줄된 캐시 워밍 실패:', error);
  }
}

/**
 * 트리거 함수: 피크 시간 캐시 워밍
 */
function peakTimeCacheWarming() {
  try {
    console.log('피크 시간 캐시 워밍 시작');
    
    // 가벼운 워밍만 수행
    const barcodes = getFrequentProductBarcodes().slice(0, 10);
    batchGetStockDataWithCache(barcodes);
    
    console.log(`피크 시간 캐시 워밍 완료: ${barcodes.length}개`);
    
  } catch (error) {
    console.error('피크 시간 캐시 워밍 실패:', error);
  }
}
