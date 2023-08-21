FROM node:18

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

RUN npx nx build accounting

CMD [ "node", "dist/packages/accounting/main.js" ]
