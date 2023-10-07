FROM node:18

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

RUN npx nx build analytics-dashboard

CMD [ "node", "dist/packages/analytics-dashboard/main.js" ]
