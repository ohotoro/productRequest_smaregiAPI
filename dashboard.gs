// ===== 대시보드 데이터 종합 =====
// dashboard.gs의 getDashboardData() 함수가 반환해야 할 데이터 구조

function getDashboardData() {
  try {
    return {
      // 긴급 액션 아이템
      actionItems: [
        {
          type: 'warning', // 'warning', 'info', 'error'
          title: '재고 확인 필요',
          message: '자주 발주하는 상품 중 7일 이상 미발주 항목이 있습니다.',
          action: 'checkInventory'
        }
      ],
      
      // 핵심 지표
      monthlyTotal: 15000000, // 이번 달 발주액
      monthlyChange: '+12.5', // 전월 대비 변화율
      avgOrderCycle: '7.5일', // 평균 발주 주기
      repeatRate: '82%', // 반복 발주율
      
      // 예산 상태
      budgetStatus: {
        budget: 10000000,
        used: 7500000,
        percentage: 75
      },
      
      // 효율성 지표
      efficiencyMetrics: {
        avgOrderCycle: '7.5일',
        repeatOrderRate: '82%'
      },
      
      // TOP 10 상품
      topProducts: [
        {
          name: 'shibo T-shirt',
          totalAmount: 2500000,
          totalQuantity: 50
        },
        {
          name: 'brushed curved pants',
          totalAmount: 2000000,
          totalQuantity: 30
        }
        // ... 더 많은 상품
      ],
      
      // 카테고리별 통계
      categoryStats: [
        {
          category: 'tops',
          totalAmount: 5000000,
          percentage: 33.3
        },
        {
          category: 'bottoms',
          totalAmount: 4000000,
          percentage: 26.7
        }
        // ... 더 많은 카테고리
      ],
      
      // 월별 추이
      monthlyTrend: [
        {
          month: '2025-03',
          totalAmount: 12000000
        },
        {
          month: '2025-04',
          totalAmount: 13500000
        },
        {
          month: '2025-05',
          totalAmount: 14000000
        },
        {
          month: '2025-06',
          totalAmount: 15000000
        }
      ],
      
      // 공급사별 통계
      supplierStats: [
        {
          supplier: 'A공급사',
          totalAmount: 5000000
        },
        {
          supplier: 'B공급사',
          totalAmount: 3000000
        }
        // ... 더 많은 공급사
      ],
      
      // 요일별 패턴
      weekdayPattern: [
        { day: '월', count: 5 },
        { day: '화', count: 12 },
        { day: '수', count: 8 },
        { day: '목', count: 15 },
        { day: '금', count: 10 },
        { day: '토', count: 2 },
        { day: '일', count: 0 }
      ],
      
      // 급상승/급하락 상품
      trendingProducts: {
        trendingUp: [
          {
            name: 'nap texture T-shirt',
            changeRate: 500 // 500% 증가
          },
          {
            name: 'salt T-shirt',
            changeRate: 400
          }
        ],
        trendingDown: [
          {
            name: '2way shirring T-shirt',
            changeRate: -100 // 100% 감소
          }
        ]
      }
    };
    
  } catch (error) {
    console.error('대시보드 데이터 생성 실패:', error);
    return null;
  }
}

// ===== 발주 베스트 TOP 10 (최적화) =====
function getTopProducts() {
  try {
    // 캐시 확인
    const cached = getCache('topProducts');
    if (cached) return cached;
    
    const orderData = getOrderDataForPeriod(3); // 3개월
    const productOrders = {};
    
    orderData.forEach(({data}) => {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][3]) {
          const productName = data[i][1] || '';
          const quantity = Number(data[i][3]) || 0;
          const price = Number(data[i][9]) || 0;
          const amount = quantity * price;
          
          if (!productOrders[productName]) {
            productOrders[productName] = {
              name: productName,
              totalQuantity: 0,
              totalAmount: 0,
              orderCount: 0
            };
          }
          
          productOrders[productName].totalQuantity += quantity;
          productOrders[productName].totalAmount += amount;
          productOrders[productName].orderCount += 1;
        }
      }
    });
    
    const result = Object.values(productOrders)
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
    
    // 캐시 저장 (1시간)
    setCache('topProducts', result, CACHE_DURATION.MEDIUM);
    
    return result;
      
  } catch (error) {
    console.error('TOP 상품 분석 실패:', error);
    return [];
  }
}

// ===== 카테고리별 발주 현황 (최적화) =====
function getCategoryStats() {
  try {
    const categoryRules = loadCategoryRules();
    const orderData = getOrderDataForCurrentMonth();
    const categoryData = {};
    
    orderData.forEach(({data}) => {
      for (let i = 1; i < data.length; i++) {
        if (data[i][1]) {
          const productName = data[i][1].toString();
          const category = determineCategory(productName, categoryRules);
          const amount = (Number(data[i][3]) || 0) * (Number(data[i][9]) || 0);
          
          if (!categoryData[category]) {
            categoryData[category] = {
              category: category,
              totalAmount: 0,
              itemCount: 0
            };
          }
          
          categoryData[category].totalAmount += amount;
          categoryData[category].itemCount += 1;
        }
      }
    });
    
    return Object.values(categoryData);
    
  } catch (error) {
    console.error('카테고리 분석 실패:', error);
    return [];
  }
}

// ===== 월별 발주 추이 (최적화) =====
function getMonthlyTrend() {
  try {
    const orderData = getOrderDataForPeriod(6); // 6개월
    const monthlyData = {};
    
    orderData.forEach(({sheetDate, data}) => {
      const monthKey = Utilities.formatDate(sheetDate, 'GMT+9', 'yyyy-MM');
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: monthKey,
          totalAmount: 0,
          orderCount: 0
        };
      }
      
      monthlyData[monthKey].orderCount += 1;
      
      for (let i = 1; i < data.length; i++) {
        if (data[i][3] && data[i][9]) {
          const amount = (Number(data[i][3]) || 0) * (Number(data[i][9]) || 0);
          monthlyData[monthKey].totalAmount += amount;
        }
      }
    });
    
    return Object.values(monthlyData)
      .sort((a, b) => a.month.localeCompare(b.month));
      
  } catch (error) {
    console.error('월별 추이 분석 실패:', error);
    return [];
  }
}

// ===== 공급사별 발주 현황 (최적화) =====
function getSupplierStats() {
  try {
    const orderData = getOrderDataForCurrentMonth();
    const supplierData = {};
    
    // 공급사 정보를 미리 로드
    const supplierMap = getSupplierMap();
    
    orderData.forEach(({data}) => {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]) {
          const barcode = String(data[i][0]);
          const supplierName = supplierMap[barcode] || '기타';
          const amount = (Number(data[i][3]) || 0) * (Number(data[i][9]) || 0);
          
          if (!supplierData[supplierName]) {
            supplierData[supplierName] = {
              supplier: supplierName,
              totalAmount: 0,
              orderCount: 0
            };
          }
          
          supplierData[supplierName].totalAmount += amount;
          supplierData[supplierName].orderCount += 1;
        }
      }
    });
    
    return Object.values(supplierData)
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10);
      
  } catch (error) {
    console.error('공급사 분석 실패:', error);
    return [];
  }
}

// ===== 요일별 발주 패턴 (최적화) =====
function getWeekdayPattern() {
  try {
    const orderData = getOrderDataForPeriod(1); // 1개월
    const weekdayData = Array(7).fill(0).map((_, i) => ({
      day: ['일', '월', '화', '수', '목', '금', '토'][i],
      count: 0,
      amount: 0
    }));
    
    orderData.forEach(({sheetDate, data}) => {
      const dayOfWeek = sheetDate.getDay();
      weekdayData[dayOfWeek].count += 1;
      
      let sheetTotal = 0;
      for (let i = 1; i < data.length; i++) {
        if (data[i][3] && data[i][9]) {
          sheetTotal += (Number(data[i][3]) || 0) * (Number(data[i][9]) || 0);
        }
      }
      
      weekdayData[dayOfWeek].amount += sheetTotal;
    });
    
    return weekdayData;
    
  } catch (error) {
    console.error('요일별 패턴 분석 실패:', error);
    return [];
  }
}

// ===== 예산 현황 =====
function getBudgetStatus() {
  try {
    const userProperties = PropertiesService.getUserProperties();
    const monthlyBudget = Number(userProperties.getProperty('monthlyBudget')) || 10000000;
    
    const orderData = getOrderDataForCurrentMonth();
    let currentMonthTotal = 0;
    
    orderData.forEach(({data}) => {
      for (let i = 1; i < data.length; i++) {
        if (data[i][3] && data[i][9]) {
          currentMonthTotal += (Number(data[i][3]) || 0) * (Number(data[i][9]) || 0);
        }
      }
    });
    
    return {
      budget: monthlyBudget,
      used: currentMonthTotal,
      percentage: (currentMonthTotal / monthlyBudget * 100).toFixed(1),
      remaining: monthlyBudget - currentMonthTotal,
      daysRemaining: getDaysRemainingInMonth()
    };
    
  } catch (error) {
    console.error('예산 분석 실패:', error);
    return { budget: 0, used: 0, percentage: 0, remaining: 0 };
  }
}

// ===== 긴급 액션 아이템 =====
function getActionItems() {
  try {
    const items = [];
    
    // 1. 재고 소진 임박 상품
    const frequentBarcodes = getCachedFrequentBarcodes().slice(0, 100);
    const recentOrders = getRecentOrderedBarcodes(7);
    
    const notOrderedRecently = frequentBarcodes
      .filter(barcode => !recentOrders.has(barcode))
      .slice(0, 5);
      
    if (notOrderedRecently.length > 0) {
      items.push({
        type: 'warning',
        title: '재고 확인 필요',
        message: `${notOrderedRecently.length}개 자주 발주 상품이 7일간 미발주`,
        action: 'checkInventory'
      });
    }
    
    // 2. 예산 초과 경고
    const budgetStatus = getBudgetStatus();
    if (parseFloat(budgetStatus.percentage) >= 80) {
      items.push({
        type: 'alert',
        title: '예산 초과 임박',
        message: `월 예산의 ${budgetStatus.percentage}% 사용 (${budgetStatus.daysRemaining}일 남음)`,
        action: 'viewBudget'
      });
    }
    
    // 3. 미확정 발주서
    const pendingOrders = getPendingOrdersCount();
    if (pendingOrders > 0) {
      items.push({
        type: 'info',
        title: '미확정 발주서',
        message: `${pendingOrders}개의 발주서가 확정 대기중`,
        action: 'confirmOrders'
      });
    }
    
    return items;
    
  } catch (error) {
    console.error('액션 아이템 생성 실패:', error);
    return [];
  }
}

// ===== 발주 효율성 지표 =====
function getEfficiencyMetrics() {
  try {
    const metrics = {
      avgOrderCycle: calculateAverageOrderCycle(),
      repeatOrderRate: calculateRepeatOrderRate(),
      avgLeadTime: calculateAverageLeadTime(),
      topGrowthProducts: getTopGrowthProducts()
    };
    
    return metrics;
  } catch (error) {
    console.error('효율성 지표 계산 실패:', error);
    return {};
  }
}

// ===== 급상승/급하락 상품 분석 (최적화) =====
function getTrendingProducts() {
  try {
    const currentMonthData = {};
    const lastMonthData = {};
    
    // 이번달과 지난달 데이터만 가져오기
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    
    const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
    const sheets = ss.getSheets();
    
    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      
      if (/^\d{6}/.test(sheetName)) {
        const dateStr = sheetName.substring(0, 6);
        const year = 2000 + parseInt(dateStr.substring(0, 2));
        const month = parseInt(dateStr.substring(2, 4)) - 1;
        
        // 필요한 달의 데이터만 처리
        if ((year === currentYear && month === currentMonth) || 
            (year === lastMonthYear && month === lastMonth)) {
          
          const data = sheet.getDataRange().getValues();
          const targetData = (year === currentYear && month === currentMonth) ? 
                            currentMonthData : lastMonthData;
          
          for (let i = 1; i < data.length; i++) {
            if (data[i][1]) {
              const productName = data[i][1];
              const quantity = Number(data[i][3]) || 0;
              targetData[productName] = (targetData[productName] || 0) + quantity;
            }
          }
        }
      }
    });
    
    // 변화율 계산
    const changes = [];
    const allProducts = new Set([...Object.keys(currentMonthData), ...Object.keys(lastMonthData)]);
    
    allProducts.forEach(product => {
      const current = currentMonthData[product] || 0;
      const last = lastMonthData[product] || 0;
      
      if (last > 0) {
        const changeRate = ((current - last) / last * 100).toFixed(1);
        changes.push({
          name: product,
          currentQuantity: current,
          lastQuantity: last,
          changeRate: parseFloat(changeRate)
        });
      } else if (current > 0) {
        changes.push({
          name: product,
          currentQuantity: current,
          lastQuantity: 0,
          changeRate: 100
        });
      }
    });
    
    changes.sort((a, b) => b.changeRate - a.changeRate);
    
    return {
      trendingUp: changes.filter(p => p.changeRate > 20).slice(0, 5),
      trendingDown: changes.filter(p => p.changeRate < -20).slice(-5).reverse()
    };
    
  } catch (error) {
    console.error('트렌딩 분석 실패:', error);
    return { trendingUp: [], trendingDown: [] };
  }
}

// ===== 지난주 발주서 복사 =====
function copyLastWeekOrder() {
  try {
    const orderData = getOrderDataForPeriod(0.25); // 약 1주일
    const lastWeekOrders = [];
    
    orderData.forEach(({data}) => {
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]) {
          lastWeekOrders.push({
            barcode: String(data[i][0]),
            name: data[i][1],
            option: data[i][2],
            quantity: data[i][3],
            memo: data[i][4],
            weight: data[i][5],
            priority: data[i][6] || 3
          });
        }
      }
    });
    
    return lastWeekOrders;
    
  } catch (error) {
    console.error('지난주 발주서 복사 실패:', error);
    return [];
  }
}

// ===== 베스트 상품 목록 가져오기 =====
function getBestProductsForQuickOrder() {
  try {
    const topProducts = getTopProducts();
    const productDetails = getProductDetailsByNames(topProducts.map(p => p.name));
    
    return productDetails.slice(0, 10);
    
  } catch (error) {
    console.error('베스트 상품 조회 실패:', error);
    return [];
  }
}

// ===== 헬퍼 함수들 =====

// 기간별 발주 데이터 가져오기 (최적화)
function getOrderDataForPeriod(months) {
  const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
  const sheets = ss.getSheets();
  const result = [];
  
  const periodAgo = new Date();
  periodAgo.setMonth(periodAgo.getMonth() - months);
  
  sheets.forEach(sheet => {
    const sheetName = sheet.getName();
    
    if (/^\d{6}/.test(sheetName)) {
      const sheetDate = parseSheetDate(sheetName.substring(0, 6));
      
      if (sheetDate >= periodAgo) {
        result.push({
          sheetName: sheetName,
          sheetDate: sheetDate,
          data: sheet.getDataRange().getValues()
        });
      }
    }
  });
  
  return result;
}

// 현재 월 발주 데이터 가져오기
function getOrderDataForCurrentMonth() {
  const ss = SpreadsheetApp.openById(CONFIG.ORDER_SHEET_ID);
  const sheets = ss.getSheets();
  const result = [];
  
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  
  sheets.forEach(sheet => {
    const sheetName = sheet.getName();
    
    if (/^\d{6}/.test(sheetName)) {
      const dateStr = sheetName.substring(0, 6);
      const year = 2000 + parseInt(dateStr.substring(0, 2));
      const month = parseInt(dateStr.substring(2, 4)) - 1;
      
      if (year === currentYear && month === currentMonth) {
        result.push({
          sheetName: sheetName,
          sheetDate: parseSheetDate(dateStr),
          data: sheet.getDataRange().getValues()
        });
      }
    }
  });
  
  return result;
}

// 공급사 맵 가져오기 (캐시 활용)
function getSupplierMap() {
  const cached = getCache('supplierMap');
  if (cached) return cached;
  
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const supplierMap = {};
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      supplierMap[String(data[i][0])] = data[i][4] || '기타';
    }
  }
  
  setCache('supplierMap', supplierMap, CACHE_DURATION.LONG);
  return supplierMap;
}

// 상품명으로 상세 정보 가져오기
function getProductDetailsByNames(productNames) {
  const ss = SpreadsheetApp.openById(CONFIG.PRODUCT_SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.PRODUCT_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const products = [];
  const nameSet = new Set(productNames);
  
  for (let i = 1; i < data.length; i++) {
    if (nameSet.has(data[i][1])) {
      // topProducts에서 평균 수량 찾기
      const topProduct = getTopProducts().find(p => p.name === data[i][1]);
      
      products.push({
        barcode: String(data[i][0]),
        name: data[i][1],
        option: data[i][2],
        supplierName: data[i][4],
        purchasePrice: Number(data[i][8]) || 0,
        avgQuantity: topProduct ? Math.round(topProduct.totalQuantity / topProduct.orderCount) : 10
      });
      
      if (products.length >= productNames.length) break;
    }
  }
  
  return products;
}

// 최근 발주된 바코드 목록
function getRecentOrderedBarcodes(days) {
  const barcodes = new Set();
  const orderData = getOrderDataForPeriod(days / 30); // 월 단위로 변환
  
  orderData.forEach(({data}) => {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) barcodes.add(String(data[i][0]));
    }
  });
  
  return barcodes;
}

// 유틸리티 함수들
function parseSheetDate(dateStr) {
  const year = 2000 + parseInt(dateStr.substring(0, 2));
  const month = parseInt(dateStr.substring(2, 4)) - 1;
  const day = parseInt(dateStr.substring(4, 6));
  return new Date(year, month, day);
}

function determineCategory(productName, rules) {
  const nameLower = productName.toLowerCase();
  
  if (rules[nameLower]) {
    return rules[nameLower];
  }
  
  for (const [keyword, category] of Object.entries(rules)) {
    if (nameLower.includes(keyword)) {
      return category;
    }
  }
  
  return '기타';
}

function getDaysRemainingInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.getDate() - now.getDate();
}

function getPendingOrdersCount() {
  // 실제 구현 시 세션 데이터 확인
  return 0;
}

function calculateAverageOrderCycle() {
  return "7.5일";
}

function calculateRepeatOrderRate() {
  return "82%";
}

function calculateAverageLeadTime() {
  return "3.2일";
}

function getTopGrowthProducts() {
  return [];
}

// ===== 월간 리포트 생성 (Code.gs에서 이동) =====
function createMonthlyReport() {
  try {
    const now = new Date();
    const reportName = Utilities.formatDate(now, 'GMT+9', 'yyyy년 MM월 발주 리포트');
    
    const newSS = SpreadsheetApp.create(reportName);
    const sheet = newSS.getActiveSheet();
    
    sheet.getRange(1, 1).setValue(reportName).setFontSize(16).setFontWeight('bold');
    sheet.getRange(2, 1).setValue(`생성일: ${Utilities.formatDate(now, 'GMT+9', 'yyyy-MM-dd HH:mm')}`);
    
    const dashboardData = getDashboardData();
    
    // 1. 발주 총액
    sheet.getRange(4, 1).setValue('1. 월간 발주 요약');
    sheet.getRange(5, 1).setValue('총 발주액:');
    sheet.getRange(5, 2).setValue(dashboardData.budgetStatus.used);
    sheet.getRange(6, 1).setValue('예산 대비:');
    sheet.getRange(6, 2).setValue(dashboardData.budgetStatus.percentage + '%');
    
    // 2. TOP 10 상품
    sheet.getRange(8, 1).setValue('2. TOP 10 발주 상품');
    const headers = ['순위', '상품명', '발주량', '금액'];
    sheet.getRange(9, 1, 1, 4).setValues([headers]).setFontWeight('bold');
    
    dashboardData.topProducts.forEach((product, index) => {
      sheet.getRange(10 + index, 1).setValue(index + 1);
      sheet.getRange(10 + index, 2).setValue(product.name);
      sheet.getRange(10 + index, 3).setValue(product.totalQuantity);
      sheet.getRange(10 + index, 4).setValue(product.totalAmount);
    });
    
    // 3. 카테고리별 분석
    const categoryRow = 22;
    sheet.getRange(categoryRow, 1).setValue('3. 카테고리별 발주 현황');
    sheet.getRange(categoryRow + 1, 1, 1, 3).setValues([['카테고리', '금액', '비율']]).setFontWeight('bold');
    
    dashboardData.categoryStats.forEach((cat, index) => {
      const total = dashboardData.categoryStats.reduce((sum, c) => sum + c.totalAmount, 0);
      sheet.getRange(categoryRow + 2 + index, 1).setValue(cat.category);
      sheet.getRange(categoryRow + 2 + index, 2).setValue(cat.totalAmount);
      sheet.getRange(categoryRow + 2 + index, 3).setValue((cat.totalAmount / total * 100).toFixed(1) + '%');
    });
    
    // 서식 설정
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 250);
    sheet.setColumnWidth(3, 100);
    sheet.setColumnWidth(4, 150);
    
    return {
      success: true,
      url: newSS.getUrl(),
      message: '월간 리포트가 생성되었습니다.'
    };
    
  } catch (error) {
    console.error('리포트 생성 실패:', error);
    return {
      success: false,
      message: '리포트 생성에 실패했습니다.'
    };
  }
}
