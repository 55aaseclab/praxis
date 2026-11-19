import { z } from 'zod';

export const PUBLIC_GUIDANCE_MCP_PATH = '/mcp/guide';
export const PUBLIC_GUIDANCE_TOOLS = Object.freeze([
  Object.freeze({ name: 'praxis_about', title: 'About Praxis', titleZh: '了解 Praxis', descriptionZh: '读取固定的产品介绍、公共指南及授权业务操作的区别。', description: 'Read the fixed public introduction to Praxis and the distinction between public guidance and authorized business operations.', schema: z.object({}).strict(), readOnly: true }),
  Object.freeze({ name: 'praxis_use_guide', title: 'Using Praxis', titleZh: 'Praxis 使用指南', descriptionZh: '读取登录、外部智能体接入及用户确认的安装快捷方式指南，不访问账号。', description: 'Read public login, external-agent connection and user-confirmed home-screen or desktop shortcut instructions. Does not install anything or access an account.', schema: z.object({ platform: z.enum(['ios_safari', 'android_chrome', 'desktop', 'other']) }).strict(), readOnly: true }),
]);
