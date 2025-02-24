// Import thư viện cần thiết
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

const keep_alive = require('./keep_alive.js')

// Token của bot - thay thế bằng token bot của bạn
const token = '6737397282:AAEGGicIi4DRKOtDXIuWaOUpPQlIwqW_t2o';

// Tạo một instance bot với chế độ polling
const bot = new TelegramBot(token, { polling: true });

// Danh sách từ khóa spam mở rộng
const spamKeywords = [
  // Chửi bậy, tục tĩu
  "lừa đảo", "chó", "dmm", "lồn", "lừa", "địt", "bịp", "campuchia", "bọn điên",
  "súc vật", "vl", "có cl", "cút", "dm", "vkl", "mày", "xạo", "địt cụ", "con căc", "cc", "dốt", "chết", "khốn nạn",
  // Từ viết tắt
  "đcm", "đmm", "clgt", "vcl", "vloz", "đkm", "cmm", "đậu xanh", "vc", "đcmm", "mẹ",
  // Thêm các từ khác
  "ngu", "óc chó", "cặc", "lon", "đụ", "mat day", "ku", "như lồn", "chet me", "đb", "bọn", "điên"
];

// Danh sách groupId được phép kiểm tra
const allowedGroupIds = [-1002208226506, -1002333438294];

// Map để lưu thời gian tin nhắn cuối cùng của mỗi user (không dùng nữa nhưng vẫn giữ lại nếu cần mở rộng chức năng)
const userLastMessageTime = new Map();

/**
 * Hàm kiểm tra tin nhắn spam dựa trên:
 * - Nội dung chứa từ khóa spam
 * - Nội dung chứa đường link
 * - Nội dung có tag @ trỏ đến thành viên không phải admin
 */
async function checkSpamMessage(msg, messageContent) {
  if (!messageContent) return false;
  
  const lowerCaseMessage = messageContent.toLowerCase();
  const userId = msg.from.id;
  
  // Kiểm tra quyền admin của người gửi, nếu là admin thì bỏ qua kiểm tra spam
  const chatMember = await bot.getChatMember(msg.chat.id, userId);
  if (chatMember.status === 'administrator' || chatMember.status === 'creator') {
    return false;
  }

  // Kiểm tra độ dài tin nhắn (trên 100 từ)
  if (messageContent.split(' ').length > 100) {
    return true;
  }

  // Kiểm tra từ khóa spam
  const containsSpam = spamKeywords.some(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    return regex.test(lowerCaseMessage);
  });
  if (containsSpam) return true;

  // Kiểm tra tin nhắn chứa đường link
  const urlRegex = /https?:\/\/\S+/i;
  if (urlRegex.test(messageContent)) {
    return true;
  }
  
  // Kiểm tra tag @ không phải admin
  // Lấy danh sách admin của nhóm
  let admins = [];
  try {
    admins = await bot.getChatAdministrators(msg.chat.id);
  } catch (err) {
    console.error("Lỗi khi lấy danh sách admin:", err);
  }
  // Tạo một set các username (loại bỏ dấu @ nếu có) của admin
  const adminUsernames = new Set();
  admins.forEach(admin => {
    if (admin.user.username) {
      adminUsernames.add(admin.user.username.toLowerCase());
    }
  });
  
  // Tìm các tag trong tin nhắn (theo dạng @username)
  const tagRegex = /@(\w+)/g;
  let match;
  while ((match = tagRegex.exec(messageContent)) !== null) {
    const taggedUsername = match[1].toLowerCase();
    // Nếu tag không thuộc danh sách admin, coi là spam
    if (!adminUsernames.has(taggedUsername)) {
      return true;
    }
  }
  
  return false;
}

// Xử lý tin nhắn
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageContent = msg.text || msg.caption;
  const userId = msg.from.id;

  // Kiểm tra nhóm được phép
  if (!allowedGroupIdss.includes(chatId)) {
    return;
  }

  try {
    const isSpam = await checkSpamMessage(msg, messageContent);
    
    if (isSpam) {
      // Chỉ xóa tin nhắn spam
      await bot.deleteMessage(chatId, msg.message_id);
    } else {
      // Nếu cần cập nhật thời gian gửi tin (ở đây đã bỏ kiểm tra gửi quá nhanh)
      const currentTime = new Date().getTime();
      userLastMessageTime.set(userId, currentTime);
    }
  } catch (error) {
    console.error("Lỗi khi xử lý tin nhắn:", error);
  }
});

// Xử lý tin nhắn chỉnh sửa
bot.on('edited_message', async (msg) => {
  const chatId = msg.chat.id;
  const messageContent = msg.text || msg.caption;
  const userId = msg.from.id;

  if (!allowedGroupIdss.includes(chatId)) {
    return;
  }

  try {
    const isSpam = await checkSpamMessage(msg, messageContent);
    
    if (isSpam) {
      await bot.deleteMessage(chatId, msg.message_id);
    } else {
      // Cập nhật thời gian gửi tin nếu cần
      const currentTime = new Date().getTime();
      userLastMessageTime.set(userId, currentTime);
    }
  } catch (error) {
    console.error("Lỗi khi xử lý tin nhắn chỉnh sửa:", error);
  }
});

// Định kỳ xóa dữ liệu cũ trong Map để tránh memory leak (nếu sử dụng)
setInterval(() => {
  const currentTime = new Date().getTime();
  for (const [userId, lastTime] of userLastMessageTime.entries()) {
    // Xóa dữ liệu của các user không hoạt động trong 5 phút
    if (currentTime - lastTime > 300000) { // 300000ms = 5 phút
      userLastMessageTime.delete(userId);
    }
  }
}, 300000); // Chạy mỗi 5 phút


// Xử lý lệnh /xinchao
bot.onText(/\/xinchao/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Xin chào! Chúc bạn một ngày tốt lành!");
});

// Xử lý khi bot khởi động
bot.on('polling_error', (error) => {
  console.error(error);
});

console.log('Bot đã được khởi động! Đang chờ tin nhắn...');


