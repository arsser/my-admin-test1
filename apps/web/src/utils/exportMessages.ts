import { LarkMessage, MessageType } from '@/types';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { MessageFilters, MessageSort } from '@/services/messagesService';
import { getMessages } from '@/services/messagesService';
import { formatBeijingTimeShort, formatBeijingTimeForFileName } from './dateUtils';

// 导出消息行类型
export interface ExportMessageRow {
  序号: number;
  群组名称: string;
  发送者名称: string;
  发送者类型: string;
  消息内容: string;
  消息类型: string;
  创建时间: string;
  消息ID: string;
}

/**
 * 格式化消息类型为中文
 */
function formatMessageType(type: MessageType): string {
  switch (type) {
    case MessageType.TEXT:
      return '文本';
    case MessageType.IMAGE:
      return '图片';
    case MessageType.FILE:
      return '文件';
    case MessageType.SYSTEM:
      return '系统';
    default:
      return '未知';
  }
}

/**
 * 格式化单条消息为导出行
 */
export function formatMessageForExport(msg: LarkMessage, index: number): ExportMessageRow {
  const timestamp = typeof msg.timestamp === 'number' 
    ? msg.timestamp 
    : new Date(msg.timestamp).getTime();
  
  return {
    序号: index + 1,
    群组名称: msg.groupName || '未知群组',
    发送者名称: msg.senderName || msg.sender?.name || 'Unknown',
    发送者类型: msg.senderType || msg.sender?.type || 'unknown',
    消息内容: msg.content || msg.contentPreview || '',
    消息类型: formatMessageType(msg.type),
    创建时间: formatBeijingTimeShort(timestamp),
    消息ID: msg.messageId || msg.id || ''
  };
}


/**
 * 生成文件名（群聊名称_最早时间_最晚时间）
 */
function generateFileName(messages: LarkMessage[], extension: string): string {
  if (messages.length === 0) {
    const now = new Date();
    return `消息导出_${formatBeijingTimeForFileName(now)}.${extension}`;
  }
  
  // 获取群聊名称（如果有多条消息，使用第一条消息的群组名称）
  const groupName = messages[0]?.groupName || '未知群组';
  // 清理文件名中的非法字符（Windows/Linux/Mac 都不允许的字符）
  const sanitizedGroupName = groupName.replace(/[<>:"/\\|?*]/g, '_').trim();
  
  // 获取所有消息的时间戳
  const timestamps = messages.map(msg => {
    const timestamp = typeof msg.timestamp === 'number' 
      ? msg.timestamp 
      : new Date(msg.timestamp).getTime();
    return timestamp;
  });
  
  // 找到最早和最晚的时间
  const earliestTime = Math.min(...timestamps);
  const latestTime = Math.max(...timestamps);
  
  // 格式化为日期字符串（使用北京时间）
  const earliestDate = formatBeijingTimeForFileName(earliestTime);
  const latestDate = formatBeijingTimeForFileName(latestTime);
  
  return `${sanitizedGroupName}_${earliestDate}_${latestDate}.${extension}`;
}

/**
 * 下载文件
 */
function downloadFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 获取全部符合筛选条件的消息（不受分页限制）
 */
export async function getAllFilteredMessages(
  filters: MessageFilters,
  sort: MessageSort | null
): Promise<LarkMessage[]> {
  // 如果筛选条件中包含多个群组ID，Supabase 的 in 查询可能有数量限制（通常限制在 100-1000 个）
  // 如果群组数量很多，需要分批查询
  const MAX_GROUP_IDS_PER_QUERY = 100; // Supabase 的 in 查询建议限制
  
  let allMessages: LarkMessage[] = [];
  
  // 如果 groupId 是数组且数量超过限制，需要分批查询
  if (filters.groupId && Array.isArray(filters.groupId) && filters.groupId.length > MAX_GROUP_IDS_PER_QUERY) {
    console.log(`群组数量过多（${filters.groupId.length} 个），将分批查询（每批 ${MAX_GROUP_IDS_PER_QUERY} 个）`);
    
    // 分批查询
    for (let i = 0; i < filters.groupId.length; i += MAX_GROUP_IDS_PER_QUERY) {
      const batchGroupIds = filters.groupId.slice(i, i + MAX_GROUP_IDS_PER_QUERY);
      console.log(`查询第 ${Math.floor(i / MAX_GROUP_IDS_PER_QUERY) + 1} 批，群组数量: ${batchGroupIds.length}`);
      
      const batchFilters: MessageFilters = {
        ...filters,
        groupId: batchGroupIds
      };
      
      const batchMessages = await getAllFilteredMessagesForBatch(batchFilters, sort);
      allMessages = [...allMessages, ...batchMessages];
      
      console.log(`第 ${Math.floor(i / MAX_GROUP_IDS_PER_QUERY) + 1} 批查询完成，获取 ${batchMessages.length} 条消息，累计 ${allMessages.length} 条`);
    }
    
    return allMessages;
  }
  
  // 正常查询（群组数量不多或单个群组）
  return getAllFilteredMessagesForBatch(filters, sort);
}

/**
 * 获取全部符合筛选条件的消息（单批查询，不受分页限制）
 */
async function getAllFilteredMessagesForBatch(
  filters: MessageFilters,
  sort: MessageSort | null
): Promise<LarkMessage[]> {
  // 使用一个很大的 pageSize 来获取所有数据
  // 如果数据量超过 10000 条，可能需要分批获取
  const pageSize = 10000;
  let allMessages: LarkMessage[] = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    const result = await getMessages(filters, sort, {
      page: currentPage,
      pageSize
    });

    allMessages = [...allMessages, ...result.data];

    // 如果返回的数据少于 pageSize，说明已经获取完所有数据
    if (result.data.length < pageSize) {
      hasMore = false;
    } else {
      currentPage++;
    }
  }

  return allMessages;
}

/**
 * 导出为 CSV 格式
 */
export function exportToCSV(messages: LarkMessage[]): void {
  try {
    if (messages.length === 0) {
      throw new Error('没有可导出的消息');
    }
    
    // 格式化消息数据
    const rows = messages.map((msg, index) => formatMessageForExport(msg, index));
    
    // CSV 表头
    const headers: (keyof ExportMessageRow)[] = ['序号', '群组名称', '发送者名称', '发送者类型', '消息内容', '消息类型', '创建时间', '消息ID'];
    
    // 构建 CSV 内容（使用 UTF-8 BOM 确保 Excel 正确识别中文）
    let csvContent = '\uFEFF';
    csvContent += headers.join(',') + '\n';
    
    // 添加数据行（处理包含逗号、换行符的值）
    rows.forEach(row => {
      const values = headers.map(header => {
        const value = String(row[header] || '');
        // 如果值包含逗号、引号或换行符，需要用引号包裹并转义引号
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csvContent += values.join(',') + '\n';
    });
    
    // 创建 Blob 并下载
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadFile(blob, generateFileName(messages, 'csv'));
  } catch (error) {
    console.error('CSV 导出失败:', error);
    throw new Error('CSV 导出失败');
  }
}

/**
 * 导出为 JSON 格式
 */
export function exportToJSON(messages: LarkMessage[]): void {
  try {
    if (messages.length === 0) {
      throw new Error('没有可导出的消息');
    }
    
    // 格式化消息数据
    const rows = messages.map((msg, index) => formatMessageForExport(msg, index));
    
    // 转换为 JSON 字符串（格式化）
    const jsonContent = JSON.stringify(rows, null, 2);
    
    // 创建 Blob 并下载
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    downloadFile(blob, generateFileName(messages, 'json'));
  } catch (error) {
    console.error('JSON 导出失败:', error);
    throw new Error('JSON 导出失败');
  }
}

/**
 * 导出为 Excel 格式
 */
export async function exportToExcel(messages: LarkMessage[]): Promise<void> {
  try {
    if (messages.length === 0) {
      throw new Error('没有可导出的消息');
    }
    
    // 格式化消息数据
    const rows = messages.map((msg, index) => formatMessageForExport(msg, index));
    
    // 创建工作簿
    const wb = XLSX.utils.book_new();
    
    // 创建工作表
    const ws = XLSX.utils.json_to_sheet(rows);
    
    // 设置列宽（根据表头自动调整）
    const colWidths = [
      { wch: 8 },   // 序号
      { wch: 20 },  // 群组名称
      { wch: 15 },  // 发送者名称
      { wch: 12 },  // 发送者类型
      { wch: 50 },  // 消息内容
      { wch: 10 },  // 消息类型
      { wch: 20 },  // 创建时间
      { wch: 30 }   // 消息ID
    ];
    ws['!cols'] = colWidths;
    
    // 添加工作表到工作簿
    XLSX.utils.book_append_sheet(wb, ws, '消息列表');
    
    // 生成 Excel 文件并下载
    XLSX.writeFile(wb, generateFileName(messages, 'xlsx'));
  } catch (error) {
    console.error('Excel 导出失败:', error);
    throw new Error('Excel 导出失败');
  }
}

/**
 * 将文本转换为支持 PDF 显示的格式
 * 对于中文，使用 Unicode 编码确保正确显示
 */
function encodeTextForPDF(text: string): string {
  // jsPDF 3.x 版本对中文的支持有限
  // 这里提供一个简化的编码方案
  // 实际项目中，应该加载完整的中文字体文件
  return text;
}

/**
 * 将中文文本转换为图片（临时方案，用于解决中文乱码问题）
 */
function textToImage(text: string, fontSize: number = 12): Promise<string> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve('');
      return;
    }
    
    // 设置字体（使用系统支持的中文字体）
    ctx.font = `${fontSize}px "Microsoft YaHei", "SimHei", "SimSun", "Arial Unicode MS", sans-serif`;
    ctx.fillStyle = '#000000';
    
    // 测量文本宽度
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = fontSize * 1.2;
    
    // 设置画布大小
    canvas.width = textWidth + 4;
    canvas.height = textHeight + 4;
    
    // 重新设置字体（画布大小改变后需要重新设置）
    ctx.font = `${fontSize}px "Microsoft YaHei", "SimHei", "SimSun", "Arial Unicode MS", sans-serif`;
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    
    // 绘制文本
    ctx.fillText(text, 2, 2);
    
    // 转换为 base64
    const dataUrl = canvas.toDataURL('image/png');
    resolve(dataUrl);
  });
}

/**
 * 导出为 PDF 格式
 * 注意：jsPDF 默认不支持中文，这里使用 Canvas 将中文文本转换为图片的方式
 * 更好的方案：使用 jsPDF 字体转换器加载中文字体文件（如思源黑体）
 */
export async function exportToPDF(messages: LarkMessage[]): Promise<void> {
  try {
    if (messages.length === 0) {
      throw new Error('没有可导出的消息');
    }
    
    // 格式化消息数据
    const rows = messages.map((msg, index) => formatMessageForExport(msg, index));
    
    // 创建 PDF 文档（A4 横向，单位：mm）
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });
    
    // 准备表格数据
    // 注意：由于中文乱码问题，这里使用英文表头，或者使用图片方式
    const tableData = rows.map(row => [
      row.序号.toString(),
      row.群组名称,
      row.发送者名称,
      row.发送者类型,
      row.消息内容.length > 50 ? row.消息内容.substring(0, 50) + '...' : row.消息内容,
      row.消息类型,
      row.创建时间,
      row.消息ID.length > 20 ? row.消息ID.substring(0, 20) + '...' : row.消息ID
    ]);
    
    // 添加表格
    // 注意：jsPDF 默认不支持中文，中文内容可能显示为乱码
    // 要解决此问题，请参考 docs/pdf-chinese-font-setup.md 加载中文字体文件
    autoTable(doc, {
      head: [['序号', '群组名称', '发送者名称', '发送者类型', '消息内容', '消息类型', '创建时间', '消息ID']],
      body: tableData,
      styles: {
        fontSize: 8,
        cellPadding: 2,
        font: 'helvetica',
        textColor: [0, 0, 0],
        overflow: 'linebreak',
        cellWidth: 'wrap'
      },
      headStyles: {
        fillColor: [66, 139, 202],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 8
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245]
      },
      margin: { top: 10, right: 10, bottom: 10, left: 10 },
      startY: 10,
      columnStyles: {
        0: { cellWidth: 15 },
        1: { cellWidth: 30 },
        2: { cellWidth: 25 },
        3: { cellWidth: 20 },
        4: { cellWidth: 60 },
        5: { cellWidth: 15 },
        6: { cellWidth: 30 },
        7: { cellWidth: 40 }
      },
      // 处理中文文本 - 尝试使用 Unicode 编码
      didParseCell: function (data: any) {
        if (data.cell.text) {
          // 确保文本是字符串格式
          data.cell.text = Array.isArray(data.cell.text) 
            ? data.cell.text.map((t: any) => String(t))
            : String(data.cell.text);
        }
      }
    });
    
    // 保存 PDF
    doc.save(generateFileName(messages, 'pdf'));
    
    // 显示提示信息
    console.warn('PDF 导出完成。注意：jsPDF 默认不支持中文，中文内容可能显示为乱码。');
    console.warn('建议：使用 jsPDF 字体转换器（https://github.com/parallax/jsPDF/blob/master/fontconverter/fontconverter.html）');
    console.warn('加载中文字体文件（如思源黑体）以获得完整的中文支持。');
  } catch (error) {
    console.error('PDF 导出失败:', error);
    throw new Error('PDF 导出失败');
  }
}

