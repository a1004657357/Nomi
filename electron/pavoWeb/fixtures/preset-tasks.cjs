const zlib = require('node:zlib');

function generateTestPNG(width, height, r, g, b) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    const table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function makeChunk(type, data) {
    const typeB = Buffer.from(type, 'ascii');
    const lenB = Buffer.alloc(4);
    lenB.writeUInt32BE(data.length, 0);
    const crcInput = Buffer.concat([typeB, data]);
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([lenB, typeB, data, crcB]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const rawRow = Buffer.alloc(1 + width * 3);
  rawRow[0] = 0;
  for (let x = 0; x < width; x++) {
    rawRow[1 + x * 3] = r;
    rawRow[1 + x * 3 + 1] = g;
    rawRow[1 + x * 3 + 2] = b;
  }
  const rawData = Buffer.concat(Array(height).fill(rawRow));
  const compressed = zlib.deflateSync(rawData);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', iend),
  ]);
}

function makeTestImageBase64(r, g, b) {
  const png = generateTestPNG(512, 512, r, g, b);
  return 'data:image/png;base64,' + png.toString('base64');
}

function initPresetTasks(addTask, taskStore) {
  addTask({
    priority: 1,
    tags: ['portrait', 'dance'],
    description: '女孩跳舞测试视频',
    modelConfig: {
      model: 'Agnes Video 2.5 Flash',
      referenceMode: '全能参考',
      aspectRatio: '16:9',
      duration: '4s',
    },
    referenceFiles: [
      { fileName: 'girl-dance-ref1.png', base64: makeTestImageBase64(200, 100, 100), fileType: 'image/png' },
      { fileName: 'girl-dance-ref2.png', base64: makeTestImageBase64(100, 200, 100), fileType: 'image/png' },
    ],
    prompt: '一个穿红色裙子的女孩 (@图片1) 在舞台上优雅地跳舞 (@图片2)',
    realSubmit: false,
  });

  addTask({
    priority: 2,
    tags: ['landscape', 'nature'],
    description: '风景延时摄影',
    modelConfig: {
      model: 'Agnes Video 2.5 Flash',
      referenceMode: '全能参考',
      aspectRatio: '16:9',
      duration: '4s',
    },
    referenceFiles: [
      { fileName: 'mountain-view.png', base64: makeTestImageBase64(80, 130, 200), fileType: 'image/png' },
    ],
    prompt: '壮丽的山脉日出延时摄影 (@图片1) 云海翻涌光影变幻',
    realSubmit: false,
  });

  addTask({
    priority: 3,
    tags: ['product', 'commercial'],
    description: '产品展示旋转',
    modelConfig: {
      model: 'Agnes Video 2.5 Flash',
      referenceMode: '全能参考',
      aspectRatio: '1:1',
      duration: '4s',
    },
    referenceFiles: [
      { fileName: 'product-front.png', base64: makeTestImageBase64(240, 240, 240), fileType: 'image/png' },
    ],
    prompt: '精致的产品在白色背景上缓慢旋转展示 (@图片1)',
    realSubmit: false,
  });

  console.log(`  📦 已初始化 ${taskStore.size} 个预制任务`);
}

module.exports = { initPresetTasks, makeTestImageBase64 };
