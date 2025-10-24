# ------------------------------
# Stage 1 — Build
# ------------------------------
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source and prisma schema
COPY src ./src
COPY prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Compile TypeScript to JavaScript
RUN npm run build

# ------------------------------
# Stage 2 — Runtime
# ------------------------------
FROM node:18-alpine

WORKDIR /app

# Copy only necessary files from builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

# Prisma needs the client generated
RUN npx prisma generate

# Expose app port
EXPOSE 3000

# Start command
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]

